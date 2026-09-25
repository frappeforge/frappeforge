import { describe, expect, it } from 'vitest'

import { type ClientOptions, resolveConfig } from '../src/config.js'
import { ConfigurationError } from '../src/errors.js'

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
        })
    })

    it('keeps every option it was given', () => {
        const fetch = (): Promise<Response> => Promise.resolve(new Response())
        expect(resolveConfig({ url, headers: { 'X-Trace': '1' }, timeout: 0, siteName: 'site1.local', fetch })).toEqual(
            {
                url,
                headers: { 'X-Trace': '1' },
                timeout: 0,
                siteName: 'site1.local',
                fetch,
            },
        )
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

    it.each([{ 'Bad Name': 'x' }, { 'X-A': 'line\nbreak' }])('rejects invalid header syntax %o', (headers) => {
        let error: unknown
        try {
            resolveConfig({ url, headers })
        } catch (caught) {
            error = caught
        }
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(error).toMatchObject({ message: '`headers` contains an invalid header name or value.' })
        expect((error as Error).cause).toBeInstanceOf(TypeError)
    })

    it('rejects a fetch that is not a function', () => {
        expect(() => resolveUntyped({ url, fetch: 'fetch' })).toThrow('`fetch` must be a function')
    })
})
