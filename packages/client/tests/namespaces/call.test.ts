import { describe, expect, it } from 'vitest'

import { createClient, InvalidArgumentError, PermissionError } from '../../src/index.js'
import { json, only, type Reply, stubFetch } from '../support/fetch.js'

const url = 'https://example.com'

function client(replies: Reply[] = []) {
    const { fetch, requests } = stubFetch(replies)
    return { frappe: createClient({ url, fetch }), requests }
}

const METHOD_ERROR = '`method` must be a non-empty string without "/", such as "frappe.ping".'
const ARGS_ERROR = '`args` must be a plain object of arguments.'

describe('call.get', () => {
    it('sends a GET to the method and returns `message`', async () => {
        const { frappe, requests } = client([json(200, { message: 'pong' })])
        await expect(frappe.call.get('frappe.ping')).resolves.toBe('pong')
        const request = only(requests)
        expect(request.method).toBe('GET')
        expect(request.url).toBe(`${url}/api/method/frappe.ping`)
    })

    it('encodes the arguments in the query string', async () => {
        const { frappe, requests } = client([json(200, { message: 1 })])
        await frappe.call.get('my_app.api.total', {
            name: 'SO-0001',
            qty: 2,
            draft: true,
            closed: false,
            filters: { status: 'Open' },
            skipped: undefined,
        })
        const { searchParams } = new URL(only(requests).url)
        expect(Object.fromEntries(searchParams)).toEqual({
            name: 'SO-0001',
            qty: '2',
            draft: '1',
            closed: '0',
            filters: '{"status":"Open"}',
        })
    })

    it('resolves undefined when the method returned nothing', async () => {
        const { frappe } = client([json(200, {})])
        await expect(frappe.call.get('my_app.api.touch')).resolves.toBeUndefined()
    })

    it('rejects a value the query string cannot hold, before any request', async () => {
        const { frappe, requests } = client()
        await expect(
            frappe.call.get('my_app.api.total', { at: Symbol('now') } as unknown as Record<string, string>),
        ).rejects.toThrow(InvalidArgumentError)
        expect(requests).toHaveLength(0)
    })
})

describe('call.post', () => {
    it('posts the arguments as JSON and returns `message`', async () => {
        const { frappe, requests } = client([json(200, { message: 42 })])
        const args = { name: 'SO-0001', qty: 2, draft: true, items: [{ item: 'X' }], data: 'kept' }
        await expect(frappe.call.post('my_app.api.recalculate', args)).resolves.toBe(42)
        const request = only(requests)
        expect(request.method).toBe('POST')
        expect(request.url).toBe(`${url}/api/method/my_app.api.recalculate`)
        expect(request.headers.get('content-type')).toBe('application/json')
        expect(JSON.parse(await request.text())).toEqual(args)
    })

    it('sends no body without arguments', async () => {
        const { frappe, requests } = client([json(200, {})])
        await expect(frappe.call.post('my_app.api.touch')).resolves.toBeUndefined()
        const request = only(requests)
        expect(request.body).toBeNull()
        expect(request.headers.has('content-type')).toBe(false)
    })

    it('passes a method that is not whitelisted through as a PermissionError', async () => {
        const { frappe } = client([json(403, { exc_type: 'PermissionError' })])
        await expect(frappe.call.post('my_app.api.secret')).rejects.toThrow(PermissionError)
    })
})

describe.each([
    [
        'get',
        (frappe: ReturnType<typeof client>['frappe'], method: unknown, args?: unknown) =>
            frappe.call.get(method as string, args as Record<string, string>),
    ],
    [
        'post',
        (frappe: ReturnType<typeof client>['frappe'], method: unknown, args?: unknown) =>
            frappe.call.post(method as string, args as Record<string, string>),
    ],
] as const)('call.%s checks its arguments', (verb, call) => {
    it('accepts a Server Script name, and encodes it for the URL', async () => {
        const { frappe, requests } = client([json(200, { message: 'ok' }), json(200, { message: 'ok' })])
        await call(frappe, 'get-customer')
        await call(frappe, 'my api')
        expect(requests.map((request) => request.url)).toEqual([
            `${url}/api/method/get-customer`,
            `${url}/api/method/my%20api`,
        ])
    })

    it.each([
        ['an empty name', ''],
        ['a name with "/"', 'frappe.ping/other'],
        ['a number', 42],
        ['undefined', undefined],
    ])('rejects %s as the method, before any request', async (_title, method) => {
        const { frappe, requests } = client()
        await expect(call(frappe, method)).rejects.toThrow(new InvalidArgumentError(METHOD_ERROR))
        expect(requests).toHaveLength(0)
    })

    it.each([
        ['null', null],
        ['an array', ['SO-0001']],
        ['a string', 'name=SO-0001'],
        ['FormData', new FormData()],
    ])('rejects %s as the arguments, before any request', async (_title, args) => {
        const { frappe, requests } = client()
        await expect(call(frappe, 'my_app.api.total', args)).rejects.toThrow(new InvalidArgumentError(ARGS_ERROR))
        expect(requests).toHaveLength(0)
    })

    it(`rejects an answer that is not JSON (${verb})`, async () => {
        const { frappe } = client([new Response('<html></html>', { headers: { 'content-type': 'text/html' } })])
        await expect(call(frappe, 'frappe.ping')).rejects.toThrow('Expected JSON')
    })
})
