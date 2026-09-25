import { describe, expect, it } from 'vitest'

import { ConfigurationError } from '../../src/errors.js'
import { buildUrl } from '../../src/http/url.js'

const base = 'https://example.com'

describe('buildUrl', () => {
    it('joins the site URL and the path', () => {
        expect(buildUrl(base, '/api/method/frappe.ping')).toBe(`${base}/api/method/frappe.ping`)
    })

    it('keeps a path prefix in the site URL', () => {
        expect(buildUrl(`${base}/frappe`, '/api/method/frappe.ping')).toBe(`${base}/frappe/api/method/frappe.ping`)
    })

    it('adds no "?" when the query is empty or has only null and undefined', () => {
        expect(buildUrl(base, '/api/x', {})).toBe(`${base}/api/x`)
        expect(buildUrl(base, '/api/x', { a: null, b: undefined })).toBe(`${base}/api/x`)
    })

    it('encodes each kind of query value', () => {
        const url = new URL(
            buildUrl(base, '/api/resource/Task', {
                text: 'a b&c',
                count: 20,
                yes: true,
                no: false,
                skipped: null,
                list: ['name', 'status'],
                filters: { status: 'Open' },
            }),
        )
        expect([...url.searchParams]).toEqual([
            ['text', 'a b&c'],
            ['count', '20'],
            ['yes', '1'],
            ['no', '0'],
            ['list', '["name","status"]'],
            ['filters', '{"status":"Open"}'],
        ])
    })

    it.each(['api/x', '', '/api/x?a=1', '/api/x#top'])('rejects the path %j', (path) => {
        expect(() => buildUrl(base, path)).toThrow(ConfigurationError)
    })

    // The URL parser resolves these, so the request would leave a path prefix or reach another route.
    it.each([
        '/..',
        '/../admin',
        '/api/./x',
        '/api/x/..',
        '/%2e%2E/admin',
        '/.%2e/admin',
        '/..\\admin',
        '/.\t./admin',
        '/..\n/admin',
        '/.. ',
    ])('rejects the path %j, which the URL parser would rewrite', (path) => {
        expect(() => buildUrl(`${base}/frappe`, path)).toThrow(ConfigurationError)
    })

    it.each(['/api/resource/ToDo/a..b', '/api/resource/ToDo/...', '/api/method/frappe.ping', '/api/x/.hidden'])(
        'keeps dots that are not a whole segment: %j',
        (path) => {
            expect(new URL(buildUrl(`${base}/frappe`, path)).pathname).toBe(`/frappe${path}`)
        },
    )

    it.each([
        ['a BigInt', { a: 1n }],
        [
            'a circular object',
            (() => {
                const circular: Record<string, unknown> = {}
                circular['self'] = circular
                return circular
            })(),
        ],
        ['a function', () => 1],
    ])('rejects a query value JSON cannot encode: %s', (_case, value) => {
        let error: unknown
        try {
            buildUrl(base, '/api/x', { filters: value })
        } catch (caught) {
            error = caught
        }
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(error).toMatchObject({ message: 'Query parameter "filters" cannot be encoded as JSON.' })
    })
})
