import { describe, expect, it, vi } from 'vitest'

import {
    AbortError,
    bearerAuth,
    createClient,
    InvalidArgumentError,
    NotFoundError,
    sessionAuth,
    TimeoutError,
    tokenAuth,
} from '../src/index.js'
import { exposed } from './support/expose.js'
import { hang, json, only, stubFetch } from './support/fetch.js'

const url = 'https://example.com'

describe('createClient', () => {
    it('validates options before any request', () => {
        expect(() => createClient({ url: 'example.com' })).toThrow(InvalidArgumentError)
    })

    it('exposes the normalized url and the site name on a frozen client', () => {
        const frappe = createClient({ url: `${url}/`, siteName: 'site1.local' })
        expect(frappe.url).toBe(url)
        expect(frappe.siteName).toBe('site1.local')
        expect(Object.isFrozen(frappe)).toBe(true)
        expect(createClient({ url }).siteName).toBeUndefined()
    })

    it('sends a request and returns the decoded body', async () => {
        const { fetch, requests } = stubFetch([json(200, { message: 'pong' })])
        const frappe = createClient({ url, fetch })
        await expect(frappe.request({ path: '/api/method/frappe.ping' })).resolves.toEqual({ message: 'pong' })
        expect(only(requests).url).toBe(`${url}/api/method/frappe.ping`)
    })

    it('works when request is destructured', async () => {
        const { fetch } = stubFetch([json(200, { data: [] })])
        const { request } = createClient({ url, fetch })
        await expect(request({ path: '/api/resource/ToDo' })).resolves.toEqual({ data: [] })
    })

    it('passes per-request options through', async () => {
        vi.useFakeTimers()
        try {
            const controller = new AbortController()
            controller.abort()
            const { fetch, requests } = stubFetch([hang])
            const frappe = createClient({ url, fetch })
            await expect(frappe.request({ path: '/api/x' }, { signal: controller.signal })).rejects.toBeInstanceOf(
                AbortError,
            )
            const timedOut = frappe.request({ path: '/api/x' }, { timeout: 50 }).catch((error: unknown) => error)
            await vi.advanceTimersByTimeAsync(50)
            expect(await timedOut).toBeInstanceOf(TimeoutError)
            expect(requests).toHaveLength(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it('rejects with typed errors', async () => {
        const { fetch } = stubFetch([json(404, { exc_type: 'DoesNotExistError' })])
        const frappe = createClient({ url, fetch })
        await expect(frappe.request({ path: '/api/resource/ToDo/nope' })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('hands the messages of a successful answer to onServerMessages, with the request but not its query', async () => {
        const onServerMessages = vi.fn()
        const _server_messages = JSON.stringify([JSON.stringify({ message: 'echo received' })])
        const { fetch, requests } = stubFetch([
            json(200, { message: { a: '1' }, _server_messages }),
            json(200, { message: 'pong' }),
        ])
        const frappe = createClient({ url, fetch, onServerMessages })
        await expect(frappe.call.get('my_app.api.echo', { a: 1, token: 'SECRET9f2c' })).resolves.toEqual({ a: '1' })
        await frappe.call.get('frappe.ping')
        expect(requests[0]?.url).toContain('token=SECRET9f2c')
        expect(onServerMessages).toHaveBeenCalledExactlyOnceWith([{ message: 'echo received' }], {
            method: 'GET',
            url: `${url}/api/method/my_app.api.echo`,
        })
    })

    it('exposes the namespaces on the frozen client', () => {
        const frappe = createClient({ url })
        expect(Object.keys(frappe)).toEqual(['url', 'siteName', 'request', 'auth', 'doc', 'call', 'file'])
        expect(Object.keys(frappe.auth)).toEqual(['login', 'logout', 'getLoggedUser'])
        expect(Object.isFrozen(frappe.auth)).toBe(true)
        expect(Object.keys(frappe.doc)).toEqual([
            'get',
            'getSingle',
            'getList',
            'count',
            'getValue',
            'getSingleValue',
            'exists',
            'hasPermission',
            'validateLink',
            'isAmended',
            'getPassword',
            'insert',
            'insertMany',
            'setValue',
            'rename',
            'delete',
            'submit',
            'cancel',
            'runMethod',
            'paginate',
        ])
        expect(Object.isFrozen(frappe.doc)).toBe(true)
        expect(Object.keys(frappe.call)).toEqual(['get', 'post'])
        expect(Object.isFrozen(frappe.call)).toBe(true)
        expect(Object.keys(frappe.file)).toEqual(['upload', 'download'])
        expect(Object.isFrozen(frappe.file)).toBe(true)
    })

    it.each([
        ['tokenAuth', tokenAuth({ apiKey: 'key', apiSecret: 'SECRET9f2c' })],
        ['bearerAuth', bearerAuth({ token: () => 'SECRET9f2c' })],
        ['sessionAuth', sessionAuth({ csrfToken: 'SECRET9f2c' })],
    ])('never exposes a %s credential, even after requests', async (_title, auth) => {
        const sid = 'sid=SECRET9f2c; Path=/'
        const { fetch, requests } = stubFetch([
            json(200, { message: 'Administrator' }, [['set-cookie', sid]]),
            json(200, { message: 'ok' }),
        ])
        const frappe = createClient({ url, fetch, auth })
        await frappe.request({ path: '/api/method/frappe.auth.get_logged_user' })
        await frappe.request({ method: 'POST', path: '/api/method/frappe.ping' })
        // The credential was sent...
        expect([...(requests[1]?.headers.values() ?? [])].join(' ')).toContain('SECRET9f2c')
        // ...and cannot be read back.
        expect(exposed(frappe)).not.toContain('SECRET9f2c')
        expect(exposed(auth)).not.toContain('SECRET9f2c')
    })
})
