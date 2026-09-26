import { describe, expect, it } from 'vitest'

import { tokenAuth } from '../src/auth/token.js'
import { type ClientOptions, resolveConfig } from '../src/config.js'
import { ConfigurationError } from '../src/errors.js'
import { exposed } from './support/expose.js'

const url = 'https://example.com'

/** Calls `resolveConfig` with options a JavaScript caller could pass, bypassing the types. */
function resolveUntyped(options: unknown): ReturnType<typeof resolveConfig> {
    return resolveConfig(options as ClientOptions)
}

describe('resolveConfig', () => {
    it('fills in defaults', () => {
        expect(resolveConfig({ url })).toEqual({
            url,
            headers: {},
            timeout: 30_000,
            siteName: undefined,
            fetch: undefined,
            auth: undefined,
        })
    })

    it('keeps every option it was given', () => {
        const fetch = (): Promise<Response> => Promise.resolve(new Response())
        const auth = tokenAuth({ apiKey: 'key', apiSecret: 'secret' })
        expect(
            resolveConfig({ url, headers: { 'X-Trace': '1' }, timeout: 0, siteName: 'site1.local', fetch, auth }),
        ).toEqual({
            url,
            headers: { 'X-Trace': '1' },
            timeout: 0,
            siteName: 'site1.local',
            fetch,
            auth,
        })
        expect(resolveConfig({ url, auth }).auth).toBe(auth)
    })

    it('freezes the config and a copy of the headers', () => {
        const headers = { 'X-Trace': '1' }
        const config = resolveConfig({ url, headers })
        expect(Object.isFrozen(config)).toBe(true)
        expect(Object.isFrozen(config.headers)).toBe(true)
        expect(config.headers).not.toBe(headers)
        headers['X-Trace'] = '2'
        expect(config.headers['X-Trace']).toBe('1')
    })

    it.each([
        ['https://example.com/', 'https://example.com'],
        ['http://localhost:8000', 'http://localhost:8000'],
        ['HTTPS://Example.COM:443', 'https://example.com'],
        ['https://example.com/frappe/', 'https://example.com/frappe'],
        ['https://example.com/frappe//', 'https://example.com/frappe'],
    ])('normalizes the url %j', (input, normalized) => {
        expect(resolveConfig({ url: input }).url).toBe(normalized)
    })

    it.each([
        ['not a URL', 'example.com'],
        ['another protocol', 'ftp://example.com'],
        ['credentials', 'https://user:secret@example.com'],
        ['a username alone', 'https://user@example.com'],
        ['a query', 'https://example.com/?site=a'],
        ['a fragment', 'https://example.com/#app'],
        ['a non-string', 42],
    ])('rejects a url with %s', (_case, input) => {
        expect(() => resolveUntyped({ url: input })).toThrow(ConfigurationError)
        expect(() => resolveUntyped({ url: input })).toThrow('`url` must be an http(s) URL')
    })

    it.each([undefined, null, 'https://example.com', Object.create({ url: 'https://example.com' }) as unknown])(
        'rejects %o as options',
        (options) => {
            expect(() => resolveUntyped(options)).toThrow('createClient() needs an options object')
        },
    )

    it('accepts options and headers without a prototype', () => {
        const options = Object.assign(Object.create(null) as ClientOptions, {
            url,
            headers: Object.assign(Object.create(null) as Record<string, string>, { 'X-A': 'b' }),
        })
        expect(resolveConfig(options).headers).toEqual({ 'X-A': 'b' })
    })

    it.each([2_147_483_647, 1, 0])('accepts the timeout %i', (timeout) => {
        expect(resolveConfig({ url, timeout }).timeout).toBe(timeout)
    })

    it.each([-1, 1.5, 2_147_483_648, Number.NaN, Number.POSITIVE_INFINITY, '100'])(
        'rejects the timeout %o',
        (timeout) => {
            expect(() => resolveUntyped({ url, timeout })).toThrow(
                '`timeout` must be an integer number of milliseconds from 0 to 2147483647',
            )
        },
    )

    it.each(['site1.local', 'example.com:8000', 'xn--3ds443g.example'])('accepts the siteName %j', (siteName) => {
        expect(resolveConfig({ url, siteName }).siteName).toBe(siteName)
    })

    // Anything else either fails as a header value on every request or is not a site name.
    it.each(['', 'site 1', ' site1', 'site\u0000', '站点', 'café.local', 42])('rejects the siteName %o', (siteName) => {
        expect(() => resolveUntyped({ url, siteName })).toThrow(
            '`siteName` must be a non-empty string of visible ASCII characters, e.g. "site1.local".',
        )
    })

    it.each([[['X-A', 'b']], [new Headers({ 'X-A': 'b' })], [{ 'X-A': 1 }], [null]])(
        'rejects the headers %o',
        (headers) => {
            expect(() => resolveUntyped({ url, headers })).toThrow('`headers` must be a plain object of string values.')
        },
    )

    it.each([
        [{ 'Bad Name': 'x' }, 'A header has an invalid name.'],
        [{ 'X-A': 'line\nbreak' }, 'The "X-A" header has an invalid value.'],
        [{ Authorization: 'token key:SECRET9f2c\u0000' }, 'The "Authorization" header has an invalid value.'],
        [{ 'token key:SECRET9f2c': 'x' }, 'A header has an invalid name.'],
    ])('rejects invalid header syntax %o, never quoting it', (headers, cause) => {
        let error: unknown
        try {
            resolveConfig({ url, headers })
        } catch (caught) {
            error = caught
        }
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(error).toMatchObject({ message: '`headers` contains an invalid header name or value.' })
        expect((error as Error).cause).toMatchObject({ name: 'TypeError', message: cause })
        expect(exposed(error)).not.toContain('SECRET9f2c')
        expect(exposed(error)).not.toContain('break')
    })

    it('rejects a fetch that is not a function', () => {
        expect(() => resolveUntyped({ url, fetch: 'fetch' })).toThrow('`fetch` must be a function')
    })

    it.each([
        [
            'a plain object literal',
            {
                apply() {
                    // nothing to do
                },
            },
        ],
        [
            'one with every hook',
            {
                apply() {
                    // nothing to do
                },
                credentials: 'include',
                onResponse() {
                    // nothing to do
                },
                onUnauthorized: () => true,
                clear() {
                    // nothing to do
                },
            },
        ],
        [
            'a class instance',
            new (class {
                apply(): void {
                    // nothing to do
                }
            })(),
        ],
    ])('accepts %s as auth', (_title, auth) => {
        expect(resolveUntyped({ url, auth }).auth).toBe(auth)
    })

    it.each([
        ['API credentials instead of a strategy', { apiKey: 'key', apiSecret: 'SECRET9f2c' }],
        ['null', null],
        ['a string', 'token key:SECRET9f2c'],
        ['a function', () => 'SECRET9f2c'],
        [
            'a hook that is not a function',
            {
                apply() {
                    // nothing to do
                },
                onResponse: 'SECRET9f2c',
            },
        ],
        [
            'an unknown credentials mode',
            {
                apply() {
                    // nothing to do
                },
                credentials: 'always',
            },
        ],
    ])('rejects %s as auth, without echoing it', (_title, auth) => {
        let error: unknown
        try {
            resolveUntyped({ url, auth })
        } catch (caught) {
            error = caught
        }
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(error).toMatchObject({
            message: '`auth` must be an AuthStrategy, such as tokenAuth({ apiKey, apiSecret }).',
        })
        expect(exposed(error)).not.toContain('SECRET9f2c')
    })
})
