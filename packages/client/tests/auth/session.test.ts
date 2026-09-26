import { describe, expect, it, vi } from 'vitest'

import { ConfigurationError, createClient, type RawRequest, sessionAuth } from '../../src/index.js'
import { exposed } from '../support/expose.js'
import { json, stubFetch } from '../support/fetch.js'

const url = 'https://example.com'
const ping: RawRequest = { path: '/api/method/frappe.ping' }
const SID = 'SID0f3a9c1e2b'
const CSRF = 'CSRF7d41e0'

// What Frappe sends when a System User signs in, and when they sign out: Guest cookies first,
// then the same names deleted with a past `Expires` and no `Max-Age`.
const loginCookies = [
    `sid=${SID}; Expires=Tue, 29 Sep 2099 10:00:00 GMT; Max-Age=345600; HttpOnly; Path=/; SameSite=Lax`,
    'system_user=yes; Path=/; SameSite=Lax',
    'full_name=John%20Doe; Path=/; SameSite=Lax',
    'user_id=john%40example.com; Path=/; SameSite=Lax',
    'user_image=; Path=/; SameSite=Lax',
]
const logoutCookies = [
    'sid=Guest; Expires=Tue, 29 Sep 2099 10:00:00 GMT; Max-Age=345600; HttpOnly; Path=/; SameSite=Lax',
    'full_name=Guest; Path=/; SameSite=Lax',
    ...['sid', 'full_name', 'user_id', 'user_image', 'system_user'].map(
        (name) => `${name}=; Expires=Thu, 24 Sep 2026 10:00:00 GMT; Path=/`,
    ),
]

/** A Node-shaped response: `getSetCookie()` returns every `Set-Cookie` line. */
function withCookies(cookies: readonly string[], status = 200): Response {
    return json(
        status,
        { message: 'ok' },
        cookies.map((cookie): [string, string] => ['set-cookie', cookie]),
    )
}

describe('sessionAuth: credentials', () => {
    it('sends every request with credentials: include, so browsers attach their cookies', async () => {
        const { fetch, requests } = stubFetch([json(200, {})])
        await createClient({ url, fetch, auth: sessionAuth() }).request(ping)
        expect(requests[0]?.credentials).toBe('include')
        expect(sessionAuth().credentials).toBe('include')
    })
})

describe('sessionAuth: CSRF token', () => {
    const headersFor = (strategy: ReturnType<typeof sessionAuth>, method: string): Headers => {
        const headers = new Headers()
        void strategy.apply(headers, method)
        return headers
    }

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('sends it on %s', (method) => {
        expect(headersFor(sessionAuth({ csrfToken: CSRF }), method).get('x-frappe-csrf-token')).toBe(CSRF)
    })

    it.each(['GET', 'HEAD', 'OPTIONS'])('never sends it on %s', (method) => {
        const token = vi.fn(() => CSRF)
        expect(headersFor(sessionAuth({ csrfToken: token }), method).has('x-frappe-csrf-token')).toBe(false)
        expect(token).not.toHaveBeenCalled()
    })

    it.each([
        ['post', 'POST'],
        ['patch', 'PATCH'],
        ['delete', 'DELETE'],
    ])('sends it for a lower-case %s from JavaScript, sent as %s', async (method, sent) => {
        const { fetch, requests } = stubFetch([json(200, {})])
        const frappe = createClient({ url, fetch, auth: sessionAuth({ csrfToken: CSRF }) })
        await frappe.request({ method: method as 'POST', path: '/api/method/x' })
        expect(requests[0]?.method).toBe(sent)
        expect(requests[0]?.headers.get('x-frappe-csrf-token')).toBe(CSRF)
    })

    it('reads a getter on every unsafe request', () => {
        let current: string | undefined = 'first'
        const strategy = sessionAuth({ csrfToken: () => current })
        expect(headersFor(strategy, 'POST').get('x-frappe-csrf-token')).toBe('first')
        current = 'second'
        expect(headersFor(strategy, 'POST').get('x-frappe-csrf-token')).toBe('second')
        current = undefined
        expect(headersFor(strategy, 'POST').has('x-frappe-csrf-token')).toBe(false)
    })

    it('defaults to the csrf_token global of a page Frappe rendered, read on every request', () => {
        const strategy = sessionAuth()
        expect(headersFor(strategy, 'POST').has('x-frappe-csrf-token')).toBe(false)
        vi.stubGlobal('csrf_token', CSRF)
        expect(headersFor(strategy, 'POST').get('x-frappe-csrf-token')).toBe(CSRF)
    })

    it('prefers the option over the global', () => {
        vi.stubGlobal('csrf_token', 'from-the-page')
        expect(headersFor(sessionAuth({ csrfToken: CSRF }), 'POST').get('x-frappe-csrf-token')).toBe(CSRF)
        expect(headersFor(sessionAuth({ csrfToken: () => CSRF }), 'POST').get('x-frappe-csrf-token')).toBe(CSRF)
    })

    it.each([
        ['an unrendered placeholder', '{{ csrf_token }}'],
        ['an unrendered placeholder without spaces', '{{frappe.session.csrf_token}}'],
        ['an empty string', ''],
        ['a value with a NUL', `${CSRF}\u0000`],
        ['a number', 42],
    ])('sends no token for %s, from the global or from a getter', (_title, value) => {
        vi.stubGlobal('csrf_token', value)
        expect(headersFor(sessionAuth(), 'POST').has('x-frappe-csrf-token')).toBe(false)
        expect(headersFor(sessionAuth({ csrfToken: () => value as string }), 'POST').has('x-frappe-csrf-token')).toBe(
            false,
        )
    })

    it.each([['{{ csrf_token }}'], ['{{frappe.session.csrf_token}}'], [''], ['has space'], [42], [null]])(
        'rejects a fixed csrfToken of %j',
        (csrfToken) => {
            const error = (() => {
                try {
                    sessionAuth({ csrfToken: csrfToken as string })
                } catch (caught) {
                    return caught
                }
                return undefined
            })()
            expect(error).toBeInstanceOf(ConfigurationError)
        },
    )

    it('accepts missing options, or options that are not an object, as the defaults', () => {
        expect(sessionAuth(undefined).credentials).toBe('include')
        expect(sessionAuth(null as never).credentials).toBe('include')
    })
})

describe('sessionAuth: the cookie jar (Node, where getSetCookie returns the lines)', () => {
    it('fills the jar from several Set-Cookie lines, ignoring their attributes, and sends it back', async () => {
        const { fetch, requests } = stubFetch([withCookies(loginCookies), json(200, {}), json(200, {})])
        const frappe = createClient({ url, fetch, auth: sessionAuth() })
        await frappe.request({ method: 'POST', path: '/api/method/login', body: { usr: 'john', pwd: 'x' } })
        expect(requests[0]?.headers.has('cookie')).toBe(false)
        await frappe.request(ping)
        await frappe.request({ method: 'POST', path: '/api/method/frappe.client.get_count' })
        const cookie = `sid=${SID}; system_user=yes; full_name=John%20Doe; user_id=john%40example.com; user_image=`
        expect(requests[1]?.headers.get('cookie')).toBe(cookie)
        expect(requests[2]?.headers.get('cookie')).toBe(cookie)
    })

    it('reads cookies from error responses too', async () => {
        const { fetch, requests } = stubFetch([withCookies([`sid=${SID}; Path=/`], 417), json(200, {})])
        const frappe = createClient({ url, fetch, auth: sessionAuth() })
        await expect(frappe.request(ping)).rejects.toThrow()
        await frappe.request(ping)
        expect(requests[1]?.headers.get('cookie')).toBe(`sid=${SID}`)
    })

    it('deletes a cookie on Max-Age=0 or a past Expires, and a later line wins', async () => {
        const { fetch, requests } = stubFetch([
            withCookies(['a=1', 'b=2', 'c=3', 'd=4', 'a=changed']),
            withCookies(['b=; Max-Age=0', 'c=; Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'gone=; Max-Age=0']),
            json(200, {}),
        ])
        const frappe = createClient({ url, fetch, auth: sessionAuth() })
        await frappe.request(ping)
        await frappe.request(ping)
        await frappe.request(ping)
        expect(requests[1]?.headers.get('cookie')).toBe('a=changed; b=2; c=3; d=4')
        expect(requests[2]?.headers.get('cookie')).toBe('a=changed; d=4')
    })

    it("ends empty after Frappe's logout response, which sets Guest cookies and then deletes them", async () => {
        const { fetch, requests } = stubFetch([withCookies(loginCookies), withCookies(logoutCookies), json(200, {})])
        const frappe = createClient({ url, fetch, auth: sessionAuth() })
        await frappe.request(ping)
        await frappe.request(ping)
        await frappe.request(ping)
        expect(requests[2]?.headers.has('cookie')).toBe(false)
    })

    it('ignores lines that hold no cookie', async () => {
        const { fetch, requests } = stubFetch([withCookies(['novalue', '=x', 'ok=1']), json(200, {})])
        const frappe = createClient({ url, fetch, auth: sessionAuth() })
        await frappe.request(ping)
        await frappe.request(ping)
        expect(requests[1]?.headers.get('cookie')).toBe('ok=1')
    })

    it("keeps the caller's own Cookie header while the jar is empty, and replaces it once it is not", async () => {
        const { fetch, requests } = stubFetch([withCookies([`sid=${SID}`]), json(200, {})])
        const frappe = createClient({ url, fetch, headers: { Cookie: 'sid=from-the-caller' }, auth: sessionAuth() })
        await frappe.request(ping)
        await frappe.request(ping)
        expect(requests.map((request) => request.headers.get('cookie'))).toEqual(['sid=from-the-caller', `sid=${SID}`])
    })

    it('clear() empties the jar', async () => {
        const strategy = sessionAuth()
        const { fetch, requests } = stubFetch([withCookies(loginCookies), json(200, {})])
        const frappe = createClient({ url, fetch, auth: strategy })
        await frappe.request(ping)
        strategy.clear?.()
        await frappe.request(ping)
        expect(requests[1]?.headers.has('cookie')).toBe(false)
    })

    it('keeps one jar per strategy', async () => {
        const { fetch, requests } = stubFetch([withCookies([`sid=${SID}`]), json(200, {})])
        await createClient({ url, fetch, auth: sessionAuth() }).request(ping)
        await createClient({ url, fetch, auth: sessionAuth() }).request(ping)
        expect(requests[1]?.headers.has('cookie')).toBe(false)
    })
})

describe('sessionAuth: browsers, where getSetCookie returns []', () => {
    it('leaves the jar empty and sends no Cookie; the browser attaches its own through credentials', async () => {
        // A browser's fetch never exposes Set-Cookie: the response carries none, whatever the server sent.
        const browserResponse = json(200, { message: 'Logged In', home_page: '/app', full_name: 'John Doe' })
        expect(browserResponse.headers.getSetCookie()).toEqual([])
        const { fetch, requests } = stubFetch([browserResponse, json(200, {})])
        vi.stubGlobal('csrf_token', CSRF)
        const frappe = createClient({ url, fetch, auth: sessionAuth() })
        await frappe.request({ method: 'POST', path: '/api/method/login' })
        await frappe.request({ method: 'POST', path: '/api/resource/ToDo', body: { description: 'x' } })
        expect(requests[1]?.headers.has('cookie')).toBe(false)
        expect(requests[1]?.credentials).toBe('include')
        expect(requests[1]?.headers.get('x-frappe-csrf-token')).toBe(CSRF)
    })
})

describe('sessionAuth: a fetch whose Headers have no getSetCookie', () => {
    it('treats the response as one without cookies instead of failing the request', async () => {
        // Some fetch polyfills implement Headers without getSetCookie.
        const response = json(200, { message: 'ok' })
        Object.defineProperty(response.headers, 'getSetCookie', { value: undefined })
        const { fetch, requests } = stubFetch([response, json(200, {})])
        const frappe = createClient({ url, fetch, auth: sessionAuth() })
        await expect(frappe.request(ping)).resolves.toEqual({ message: 'ok' })
        await frappe.request(ping)
        expect(requests[1]?.headers.has('cookie')).toBe(false)
    })
})

describe('sessionAuth: secrecy', () => {
    it('never exposes the session cookie or the CSRF token', async () => {
        const strategy = sessionAuth({ csrfToken: CSRF })
        const { fetch } = stubFetch([withCookies(loginCookies), json(403, { exc_type: 'PermissionError' })])
        const frappe = createClient({ url, fetch, auth: strategy })
        await frappe.request(ping)
        const error = await frappe.request({ method: 'POST', path: '/api/x' }).catch((reason: unknown) => reason)

        expect(JSON.parse(JSON.stringify(strategy))).toEqual({ credentials: 'include' })
        expect(Object.isFrozen(strategy)).toBe(true)
        for (const value of [strategy, frappe, error]) {
            expect(exposed(value)).not.toContain(SID)
            expect(exposed(value)).not.toContain(CSRF)
        }
    })
})
