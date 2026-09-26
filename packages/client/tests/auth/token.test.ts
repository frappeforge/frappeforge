import { describe, expect, it } from 'vitest'

import { AuthenticationError, ConfigurationError, createClient, tokenAuth } from '../../src/index.js'
import { deferred, exposed } from '../support/expose.js'
import { json, stubFetch } from '../support/fetch.js'

const url = 'https://example.com'
const SECRET = 'SECRET9f2c'

describe('tokenAuth', () => {
    it('sends Authorization: token <key>:<secret> on every request', async () => {
        const { fetch, requests } = stubFetch([json(200, { message: 'Administrator' }), json(200, {})])
        const frappe = createClient({ url, fetch, auth: tokenAuth({ apiKey: 'key', apiSecret: SECRET }) })
        await frappe.request({ path: '/api/method/frappe.auth.get_logged_user' })
        await frappe.request({ method: 'POST', path: '/api/method/frappe.ping' })
        expect(requests.map((request) => request.headers.get('authorization'))).toEqual([
            `token key:${SECRET}`,
            `token key:${SECRET}`,
        ])
    })

    it('leaves credentials at the runtime default and has no other hooks', () => {
        const strategy = tokenAuth({ apiKey: 'key', apiSecret: SECRET })
        expect(Object.keys(strategy)).toEqual(['apply'])
        expect(Object.isFrozen(strategy)).toBe(true)
    })

    it('surfaces a rejected key as AuthenticationError, after one request', async () => {
        const { fetch, requests } = stubFetch([json(401, { exc_type: 'AuthenticationError' })])
        const frappe = createClient({ url, fetch, auth: tokenAuth({ apiKey: 'key', apiSecret: SECRET }) })
        await expect(frappe.request({ path: '/api/method/frappe.auth.get_logged_user' })).rejects.toBeInstanceOf(
            AuthenticationError,
        )
        expect(requests).toHaveLength(1)
    })

    it.each([
        ['a missing key', { apiSecret: SECRET }, 'apiKey'],
        ['an empty key', { apiKey: '', apiSecret: SECRET }, 'apiKey'],
        ['a key that is not a string', { apiKey: 42, apiSecret: SECRET }, 'apiKey'],
        ['a key containing ":"', { apiKey: 'a:b', apiSecret: SECRET }, 'apiKey'],
        ['a missing secret', { apiKey: 'key' }, 'apiSecret'],
        ['a secret containing ":"', { apiKey: 'key', apiSecret: `${SECRET}:x` }, 'apiSecret'],
        ['a secret containing a space', { apiKey: 'key', apiSecret: `${SECRET} x` }, 'apiSecret'],
        ['a secret containing a NUL', { apiKey: 'key', apiSecret: `${SECRET}\u0000` }, 'apiSecret'],
        ['a secret with a trailing newline', { apiKey: 'key', apiSecret: `${SECRET}\n` }, 'apiSecret'],
        ['a secret with non-ASCII characters', { apiKey: 'key', apiSecret: `${SECRET}é` }, 'apiSecret'],
    ])('rejects %s with a ConfigurationError that does not quote it', (_title, options, name) => {
        const error = captureError(() => tokenAuth(options as never))
        expect(error).toBeInstanceOf(ConfigurationError)
        expect((error as Error).message).toContain(`\`${name}\``)
        expect(exposed(error)).not.toContain(SECRET)
    })

    it.each([[undefined], [null], ['key:secret']])('rejects options of %j', (options) => {
        expect(() => tokenAuth(options as never)).toThrow(ConfigurationError)
    })

    it('never exposes the secret through the strategy, the client or an error', async () => {
        const answered = deferred<Response>()
        const { fetch } = stubFetch([json(200, { message: 'Administrator' }), () => answered.promise])
        const strategy = tokenAuth({ apiKey: 'key', apiSecret: SECRET })
        const frappe = createClient({ url, fetch, auth: strategy })
        await frappe.request({ path: '/api/method/frappe.auth.get_logged_user' })
        const failed = frappe.request({ path: '/api/resource/ToDo' }).catch((error: unknown) => error)
        answered.resolve(json(401, { exc_type: 'AuthenticationError' }))

        expect(JSON.parse(JSON.stringify(strategy))).toEqual({})
        expect(exposed(strategy)).not.toContain(SECRET)
        expect(exposed(frappe)).not.toContain(SECRET)
        expect(exposed(await failed)).not.toContain(SECRET)
    })
})

describe('exposed', () => {
    it('does catch a secret held on a property or in headers', () => {
        expect(exposed({ apiSecret: SECRET })).toContain(SECRET)
        expect(exposed(new Headers({ Authorization: `token key:${SECRET}` }))).toContain(SECRET)
    })
})

function captureError(run: () => unknown): unknown {
    try {
        run()
    } catch (error) {
        return error
    }
    throw new Error('expected an error')
}
