import { describe, expect, it, vi } from 'vitest'

import {
    AuthenticationError,
    type AuthStrategy,
    ConfigurationError,
    createClient,
    FrappeError,
    NetworkError,
    PermissionError,
    ServerError,
    sessionAuth,
} from '../../src/index.js'
import { exposed } from '../support/expose.js'
import { json, only, type Reply, stubFetch } from '../support/fetch.js'

const url = 'https://example.com'
const PASSWORD = 'PASSWORD5b8e'
const SID = 'SID0f3a9c1e2b'

function client(replies: Reply[], auth?: AuthStrategy) {
    const { fetch, requests } = stubFetch(replies)
    return { frappe: createClient({ url, fetch, ...(auth === undefined ? {} : { auth }) }), requests }
}

const loggedIn = (homePage: string, message = 'Logged In') =>
    json(200, { message, home_page: homePage, full_name: 'John Doe' })

describe('auth.login', () => {
    it('posts usr and pwd as JSON to /api/method/login', async () => {
        const { frappe, requests } = client([loggedIn('/app')])
        await frappe.auth.login({ username: 'john@example.com', password: PASSWORD })
        const request = only(requests)
        expect(request.method).toBe('POST')
        expect(request.url).toBe(`${url}/api/method/login`)
        expect(await request.json()).toEqual({ usr: 'john@example.com', pwd: PASSWORD })
    })

    it.each([
        ['a System User on Frappe 15', loggedIn('/app'), '/app'],
        ['a System User on Frappe 15 with a default workspace', loggedIn('/app/home'), '/app/home'],
        ['a System User on Frappe 16, whose home page has no leading slash', loggedIn('desk'), 'desk'],
        ['a Website User', loggedIn('/me', 'No App'), '/me'],
    ])('returns the full name and home page for %s', async (_title, response, homePage) => {
        const { frappe } = client([response])
        await expect(frappe.auth.login({ username: 'john', password: PASSWORD })).resolves.toEqual({
            fullName: 'John Doe',
            homePage,
        })
    })

    it('rejects when Frappe asks for a second factor, because there is no session yet', async () => {
        const { frappe } = client([
            json(200, {
                verification: { token_delivery: true, prompt: 'Verification code has been sent' },
                tmp_id: 'a1b2c3d4',
            }),
        ])
        const error = await frappe.auth
            .login({ username: 'john', password: PASSWORD })
            .catch((reason: unknown) => reason)
        expect(error).toBeInstanceOf(AuthenticationError)
        expect(error).toMatchObject({
            message: 'Two-factor authentication is not supported yet.',
            status: 200,
            request: { method: 'POST', url: `${url}/api/method/login` },
        })
    })

    it('rejects when the password has expired, because there is no session', async () => {
        const { frappe } = client([
            json(200, { message: 'Password Reset', redirect_to: '/update-password?key=abc&password_expired=true' }),
        ])
        await expect(frappe.auth.login({ username: 'john', password: PASSWORD })).rejects.toMatchObject({
            name: 'AuthenticationError',
            message: 'The password has expired and must be reset before signing in.',
        })
    })

    it.each([
        ['an unexpected object', { message: 'Logged In' }],
        ['an empty body', undefined],
        ['an array', []],
    ])('rejects %s instead of resolving a half sign-in', async (_title, body) => {
        const { frappe } = client([body === undefined ? new Response(null, { status: 200 }) : json(200, body)])
        await expect(frappe.auth.login({ username: 'john', password: PASSWORD })).rejects.toMatchObject({
            name: 'AuthenticationError',
            message: 'The server did not complete the sign-in.',
        })
    })

    it('surfaces wrong credentials as AuthenticationError, without the password', async () => {
        const { frappe } = client([
            json(401, {
                message: 'Invalid login credentials',
                exc_type: 'AuthenticationError',
                _server_messages: JSON.stringify([JSON.stringify({ message: 'Invalid login credentials' })]),
            }),
        ])
        const error = await frappe.auth
            .login({ username: 'john', password: PASSWORD })
            .catch((reason: unknown) => reason)
        expect(error).toBeInstanceOf(AuthenticationError)
        expect(error).toMatchObject({ message: 'Invalid login credentials', status: 401 })
        expect(exposed(error)).not.toContain(PASSWORD)
    })

    it.each([
        ['no username', { password: PASSWORD }],
        ['an empty username', { username: '', password: PASSWORD }],
        ['an empty password', { username: 'john', password: '' }],
        ['a password that is not a string', { username: 'john', password: 42 }],
        ['no credentials at all', undefined],
    ])('rejects %s before any request, without echoing the password', async (_title, credentials) => {
        const { frappe, requests } = client([])
        const error = await frappe.auth.login(credentials as never).catch((reason: unknown) => reason)
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(exposed(error)).not.toContain(PASSWORD)
        expect(requests).toHaveLength(0)
    })
})

describe('auth.logout', () => {
    it('posts to /api/method/logout and clears the strategy', async () => {
        const clear = vi.fn()
        const { frappe, requests } = client([json(200, {})], {
            apply() {
                // nothing to do
            },
            clear,
        })
        await expect(frappe.auth.logout()).resolves.toBeUndefined()
        expect(only(requests).method).toBe('POST')
        expect(only(requests).url).toBe(`${url}/api/method/logout`)
        expect(clear).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['a network failure', new TypeError('fetch failed'), NetworkError],
        ['a server error', json(500, { exc_type: 'Exception' }), ServerError],
        ['a 403', json(403, { exc_type: 'PermissionError' }), PermissionError],
    ])('clears the strategy even after %s, and rethrows it', async (_title, reply, ErrorClass) => {
        const clear = vi.fn()
        const { frappe } = client([reply], {
            apply() {
                // nothing to do
            },
            clear,
        })
        await expect(frappe.auth.logout()).rejects.toBeInstanceOf(ErrorClass)
        expect(clear).toHaveBeenCalledTimes(1)
    })

    it('works without a strategy, and with one that stores nothing', async () => {
        await expect(client([json(200, {})]).frappe.auth.logout()).resolves.toBeUndefined()
        await expect(
            client([json(200, {})], {
                apply() {
                    // nothing to do
                },
            }).frappe.auth.logout(),
        ).resolves.toBeUndefined()
    })
})

describe('auth.currentUser', () => {
    it('returns the signed-in user from frappe.auth.get_logged_user', async () => {
        const { frappe, requests } = client([json(200, { message: 'Administrator' })])
        await expect(frappe.auth.currentUser()).resolves.toBe('Administrator')
        expect(only(requests).method).toBe('GET')
        expect(only(requests).url).toBe(`${url}/api/method/frappe.auth.get_logged_user`)
    })

    it.each([
        ['403, what Frappe answers a Guest', json(403, { exc_type: 'PermissionError' })],
        ['401, a rejected token', json(401, { exc_type: 'AuthenticationError' })],
        ['a "Guest" message', json(200, { message: 'Guest' })],
    ])('returns null for %s', async (_title, reply) => {
        await expect(client([reply]).frappe.auth.currentUser()).resolves.toBeNull()
    })

    it.each([
        ['a server error', json(500, {}), ServerError],
        ['a network failure', new TypeError('fetch failed'), NetworkError],
        ['a message that is not a string', json(200, { message: 42 }), FrappeError],
        ['a body without a message', json(200, []), FrappeError],
    ])('rethrows %s', async (_title, reply, ErrorClass) => {
        await expect(client([reply]).frappe.auth.currentUser()).rejects.toBeInstanceOf(ErrorClass)
    })

    it('says what it expected in place of the user', async () => {
        await expect(client([json(200, { message: 42 })]).frappe.auth.currentUser()).rejects.toThrow(
            `Expected a string in \`message\` from GET ${url}/api/method/frappe.auth.get_logged_user.`,
        )
    })

    it('passes request options through', async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(client([]).frappe.auth.currentUser({ signal: controller.signal })).rejects.toMatchObject({
            name: 'CancelledError',
        })
    })
})

describe('auth with sessionAuth, end to end', () => {
    it('signs in, sends the session cookie, signs out and forgets it', async () => {
        const cookie = (line: string): [string, string] => ['set-cookie', line]
        const { frappe, requests } = client(
            [
                json(200, { message: 'Logged In', home_page: '/app', full_name: 'John Doe' }, [
                    cookie(`sid=${SID}; Max-Age=345600; HttpOnly; Path=/; SameSite=Lax`),
                    cookie('system_user=yes; Path=/'),
                ]),
                json(200, { message: 'john@example.com' }),
                json(200, {}, [
                    cookie('sid=Guest; Max-Age=345600; HttpOnly; Path=/'),
                    cookie('sid=; Expires=Thu, 24 Sep 2026 10:00:00 GMT; Path=/'),
                    cookie('system_user=; Expires=Thu, 24 Sep 2026 10:00:00 GMT; Path=/'),
                ]),
                json(403, { exc_type: 'PermissionError' }),
            ],
            sessionAuth(),
        )
        await frappe.auth.login({ username: 'john@example.com', password: PASSWORD })
        await expect(frappe.auth.currentUser()).resolves.toBe('john@example.com')
        await frappe.auth.logout()
        await expect(frappe.auth.currentUser()).resolves.toBeNull()

        expect(requests.map((request) => request.headers.get('cookie'))).toEqual([
            null,
            `sid=${SID}; system_user=yes`,
            `sid=${SID}; system_user=yes`,
            null,
        ])
        expect(exposed(frappe)).not.toContain(SID)
    })

    it('can be destructured', async () => {
        const { frappe } = client([json(200, { message: 'Administrator' })])
        const { currentUser } = frappe.auth
        await expect(currentUser()).resolves.toBe('Administrator')
        expect(Object.isFrozen(frappe.auth)).toBe(true)
    })
})
