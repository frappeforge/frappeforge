import { readdirSync, readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    AuthenticationError,
    ConflictError,
    FrappeError,
    NotFoundError,
    PermissionError,
    RateLimitError,
    ServerError,
    ValidationError,
} from '../../src/errors.js'
import { plainText, readJson, toError } from '../../src/http/decode.js'

/** A response recorded from a real Frappe site, with what the client must make of it. */
interface ResponseFixture {
    /** The Frappe version that produced the response, e.g. `Frappe 15.121.1`; `null` until recorded. */
    recordedFrom: string | null
    request: { method: string; path: string }
    response: { status: number; headers: Record<string, string>; body: string }
    expected: { value: unknown } | { name: string; status: number; exception?: string; message: string }
}

const site = 'https://example.com'
const context = { method: 'POST', url: `${site}/api/resource/Task` }

/** Responses recorded from real Frappe sites, one folder per major version. */
function loadFixtures(): (readonly [string, ResponseFixture])[] {
    const root = new URL('../fixtures/responses/', import.meta.url)
    return readdirSync(root).flatMap((version) =>
        readdirSync(new URL(`${version}/`, root))
            .filter((file) => file.endsWith('.json'))
            .map((file) => {
                const text = readFileSync(new URL(`${version}/${file}`, root), 'utf8')
                const fixture = JSON.parse(text) as ResponseFixture
                const name = `${version}/${file} (${fixture.recordedFrom ?? 'not recorded yet'})`
                return [name, fixture] as const
            }),
    )
}

function envelope(status: number, body: unknown, headers: Record<string, string> = {}): [Response, string] {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return [new Response(text, { status, headers }), text]
}

/** `_server_messages` exactly as Frappe encodes it: a JSON string of an array of JSON strings. */
function serverMessages(...items: unknown[]): string {
    return JSON.stringify(items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))))
}

afterEach(() => {
    vi.useRealTimers()
})

describe('recorded responses', () => {
    const fixtures = loadFixtures()

    it('exist for every supported version', () => {
        expect(new Set(fixtures.map(([file]) => file.split('/')[0]))).toEqual(new Set(['v15', 'v16']))
    })

    const successes = fixtures.flatMap(([file, fixture]) =>
        'value' in fixture.expected ? [[file, fixture, fixture.expected] as const] : [],
    )
    const failures = fixtures.flatMap(([file, fixture]) =>
        'value' in fixture.expected ? [] : [[file, fixture, fixture.expected] as const],
    )

    it.each(successes)('%s reads as the expected value', async (_file, { request, response }, expected) => {
        const body = new Response(response.body, { status: response.status, headers: response.headers })
        await expect(readJson(body, { method: request.method, url: site + request.path })).resolves.toEqual(
            expected.value,
        )
    })

    it.each(failures)('%s maps to the expected error', (_file, { request, response }, expected) => {
        const url = site + request.path
        const body = new Response(response.body, { status: response.status, headers: response.headers })
        const error = toError(body, response.body, { method: request.method, url })
        expect(error.toJSON()).toMatchObject({
            name: expected.name,
            status: expected.status,
            exception: expected.exception,
            message: expected.message,
            request: { method: request.method, url },
        })
    })
})

describe('readJson', () => {
    it('parses a JSON body', async () => {
        await expect(readJson(new Response('{"message":"pong"}'), context)).resolves.toEqual({ message: 'pong' })
    })

    it('returns undefined for 204 and for an empty body', async () => {
        await expect(readJson(new Response(null, { status: 204 }), context)).resolves.toBeUndefined()
        await expect(readJson(new Response(''), context)).resolves.toBeUndefined()
    })

    it('explains a 2xx body that is not JSON', async () => {
        const response = new Response('<!doctype html><title>App</title>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
        })
        const error = await readJson(response, context).catch((error: unknown) => error)
        expect(error).toBeInstanceOf(FrappeError)
        expect(error).toMatchObject({
            name: 'FrappeError',
            status: 200,
            request: context,
            message: `Expected JSON from POST ${site}/api/resource/Task, received text/html. Check the site URL and any proxy in between.`,
        })
    })

    it('says so when the content type is missing', async () => {
        const response = new Response(new Blob(['not json']))
        await expect(readJson(response, context)).rejects.toThrow('received an unknown content type.')
    })
})

describe('toError', () => {
    it.each([
        [400, FrappeError],
        [401, AuthenticationError],
        [403, PermissionError],
        [404, NotFoundError],
        [409, ConflictError],
        [417, ValidationError],
        [429, RateLimitError],
        [500, ServerError],
        [502, ServerError],
        [503, ServerError],
    ])('maps %i to %o', (status, ErrorClass) => {
        const error = toError(...envelope(status, {}), context)
        expect(error).toBeInstanceOf(ErrorClass)
        expect(error.constructor).toBe(ErrorClass)
        expect(error.status).toBe(status)
        expect(error.request).toEqual(context)
    })

    it('keeps a CSRF failure a plain FrappeError with its exception', () => {
        const error = toError(
            ...envelope(400, { exc_type: 'CSRFTokenError', exception: 'frappe.exceptions.CSRFTokenError' }),
            context,
        )
        expect(error.constructor).toBe(FrappeError)
        expect(error.exception).toBe('CSRFTokenError')
        expect(error.message).toBe('Request failed with status 400 (POST /api/resource/Task)')
    })

    describe('server messages', () => {
        it('parses the double-encoded envelope, keeping HTML and copying title and indicator', () => {
            const error = toError(
                ...envelope(417, {
                    _server_messages: serverMessages(
                        {
                            message: 'Subject is <b>mandatory</b>',
                            title: 'Message',
                            indicator: 'red',
                            raise_exception: 1,
                        },
                        { message: 'Second' },
                    ),
                }),
                context,
            )
            expect(error.serverMessages).toEqual([
                { message: 'Subject is <b>mandatory</b>', title: 'Message', indicator: 'red' },
                { message: 'Second' },
            ])
            expect(error.message).toBe('Subject is mandatory')
        })

        it('describes the failure with the message Frappe raised, not an earlier one', () => {
            const error = toError(
                ...envelope(417, {
                    _server_messages: serverMessages(
                        { message: 'Row 2: rate adjusted', indicator: 'blue' },
                        { message: 'Description is <b>mandatory</b>', raise_exception: 1 },
                        { message: 'Later note' },
                    ),
                }),
                context,
            )
            expect(error.message).toBe('Description is mandatory')
            expect(error.serverMessages).toHaveLength(3)
        })

        it('uses the first message when none is marked as raised', () => {
            const error = toError(
                ...envelope(500, { _server_messages: serverMessages({ message: 'First' }, { message: 'Second' }) }),
                context,
            )
            expect(error.message).toBe('First')
        })

        it('takes an item that is not JSON as the message itself', () => {
            const error = toError(...envelope(417, { _server_messages: serverMessages('Plain text') }), context)
            expect(error.serverMessages).toEqual([{ message: 'Plain text' }])
        })

        it('accepts items that are already objects, and skips malformed ones', () => {
            const error = toError(
                ...envelope(417, {
                    _server_messages: JSON.stringify([
                        { message: 'object item', title: 7 },
                        JSON.stringify({ title: 'no message' }),
                        JSON.stringify({ message: 42 }),
                        JSON.stringify(3),
                        null,
                    ]),
                }),
                context,
            )
            expect(error.serverMessages).toEqual([{ message: 'object item' }])
        })

        it.each([['not json'], [JSON.stringify({ not: 'an array' })], [42]])(
            'ignores a malformed envelope %j',
            (value) => {
                const error = toError(...envelope(417, { _server_messages: value }), context)
                expect(error.serverMessages).toEqual([])
            },
        )
    })

    describe('exception', () => {
        it('prefers exc_type', () => {
            const error = toError(
                ...envelope(417, { exc_type: 'MandatoryError', exception: 'frappe.exceptions.ValidationError: x' }),
                context,
            )
            expect(error.exception).toBe('MandatoryError')
        })

        it.each([
            ['frappe.exceptions.DoesNotExistError: Task X not found', 'DoesNotExistError'],
            ['pymysql.err.ProgrammingError: (1146, "table missing")', 'ProgrammingError'],
            ['ValidationError: bare', 'ValidationError'],
            ['frappe.exceptions.PermissionError', 'PermissionError'],
            ['not a class name at all', undefined],
        ])('parses the class name out of %j', (exception, expected) => {
            expect(toError(...envelope(500, { exception }), context).exception).toBe(expected)
        })
    })

    describe('message', () => {
        it('uses _error_message, as plain text, when there are no server messages', () => {
            const error = toError(
                ...envelope(500, { _error_message: 'Disk&nbsp;<i>full</i>', exception: 'X: other' }),
                context,
            )
            expect(error.message).toBe('Disk full')
        })

        it('then the text after ": " in exception', () => {
            const error = toError(
                ...envelope(404, { exception: 'frappe.exceptions.DoesNotExistError: Task X not found' }),
                context,
            )
            expect(error.message).toBe('Task X not found')
        })

        it('reduces the text after ": " in exception to plain text', () => {
            const error = toError(
                ...envelope(403, { exception: 'frappe.exceptions.PermissionError: <b>Not</b> &amp; <br>allowed' }),
                context,
            )
            expect(error.message).toBe('Not & allowed')
        })

        it('skips an empty server message', () => {
            const error = toError(
                ...envelope(417, { _server_messages: serverMessages({ message: '<br>' }), _error_message: 'Fallback' }),
                context,
            )
            expect(error.message).toBe('Fallback')
        })

        it('then the <title> of an HTML body', () => {
            const html = '<html><head><title>502 Bad Gateway</title></head><body><center>nginx</center></body></html>'
            const error = toError(...envelope(502, html, { 'content-type': 'text/html' }), context)
            expect(error).toBeInstanceOf(ServerError)
            expect(error.message).toBe('502 Bad Gateway')
            expect(error.serverMessages).toEqual([])
        })

        it.each([
            ['an empty body', ''],
            ['HTML without a title', '<html><body>Request Entity Too Large</body></html>'],
            ['JSON that is not an object', '["x"]'],
        ])('falls back to status, method and path for %s', (_case, body) => {
            const error = toError(...envelope(413, body), context)
            expect(error.message).toBe('Request failed with status 413 (POST /api/resource/Task)')
        })
    })

    describe('Retry-After', () => {
        it('reads delay-seconds', () => {
            const error = toError(...envelope(429, {}, { 'retry-after': '3' }), context)
            expect(error).toBeInstanceOf(RateLimitError)
            expect((error as RateLimitError).retryAfter).toBe(3000)
        })

        it('reads an HTTP date relative to now', () => {
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
            const error = toError(...envelope(429, {}, { 'retry-after': 'Thu, 01 Jan 2026 00:00:05 GMT' }), context)
            expect((error as RateLimitError).retryAfter).toBe(5000)
        })

        it('reads the obsolete RFC 850 date format', () => {
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
            const error = toError(...envelope(429, {}, { 'retry-after': 'Thursday, 01-Jan-26 00:00:05 GMT' }), context)
            expect((error as RateLimitError).retryAfter).toBe(5000)
        })

        it('never returns a negative delay for a date in the past', () => {
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
            const error = toError(...envelope(429, {}, { 'retry-after': 'Wed, 31 Dec 2025 23:59:00 GMT' }), context)
            expect((error as RateLimitError).retryAfter).toBe(0)
        })

        it.each([
            ['missing', {}],
            ['invalid', { 'retry-after': 'soon' }],
            ['a fraction', { 'retry-after': '1.5' }],
            ['negative', { 'retry-after': '-5' }],
            ['an ISO date, not an HTTP date', { 'retry-after': '2026-01-01T00:00:05Z' }],
            ['an asctime date, which has no time zone', { 'retry-after': 'Thu Jan  1 00:00:05 2026' }],
        ])('is undefined when %s', (_case, headers) => {
            const error = toError(...envelope(429, {}, headers), context)
            expect((error as RateLimitError).retryAfter).toBeUndefined()
        })
    })

    it('never copies the traceback, its source or debug messages into the error', () => {
        const secret = 'Traceback SECRET-FRAME /home/frappe/apps/frappe/app.py'
        const error = toError(
            ...envelope(500, {
                exc_type: 'ZeroDivisionError',
                exception: 'ZeroDivisionError: division by zero',
                exc: JSON.stringify([secret]),
                _exc_source: secret,
                _debug_messages: JSON.stringify([secret]),
            }),
            context,
        )
        expect(error.message).toBe('division by zero')
        expect(JSON.stringify(error)).not.toContain('SECRET')
        expect(error.message).not.toContain('SECRET')
        expect(error.cause).toBeUndefined()
    })
})

describe('plainText', () => {
    it.each([
        ['<b>Subject</b> is mandatory', 'Subject is mandatory'],
        ['Line one<br>Line two<br/>three', 'Line one Line two three'],
        ['<p>a</p><p>b</p>', 'a b'],
        ['<ul><li>x</li><li>y</li></ul>', 'x y'],
        ['&amp; &lt;tag&gt; &quot;q&quot; &#39;s&#39; a&nbsp;b', '& <tag> "q" \'s\' a b'],
        ['&lt;b&gt;literal&lt;/b&gt;', '<b>literal</b>'],
        ['&copy; stays', '&copy; stays'],
        ['  spaced \n\t out  ', 'spaced out'],
        [
            '<details><summary>You are not permitted to access this resource. Login to access</summary>Function <strong>frappe.auth.get_logged_user</strong> is not whitelisted.</details>',
            'You are not permitted to access this resource. Login to access Function frappe.auth.get_logged_user is not whitelisted.',
        ],
        ['<h4>Title</h4><table><tr><td>a</td><td>b</td></tr></table>', 'Title a b'],
        ['Row <span class="x">1</span>: <a href="/app/todo/1">TODO-1</a>', 'Row 1: TODO-1'],
    ])('converts %j', (html, text) => {
        expect(plainText(html)).toBe(text)
    })
})
