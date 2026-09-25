import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveConfig } from '../../src/config.js'
import {
    CancelledError,
    ConfigurationError,
    FrappeError,
    NetworkError,
    NotFoundError,
    ServerError,
    TimeoutError,
    ValidationError,
} from '../../src/errors.js'
import { readJson } from '../../src/http/decode.js'
import { send } from '../../src/http/send.js'
import type { RawRequest, RequestOptions } from '../../src/types.js'
import { hang, hangBody, json, only, type Reply, stubFetch, text } from '../support/fetch.js'

const url = 'https://example.com'
const ping = { path: '/api/method/frappe.ping' } as const

/** Sends one request through a client configured with a stub answering `replies`. */
function sendWith(
    replies: Reply[],
    init: RawRequest = ping,
    options: RequestOptions = {},
    clientOptions: { headers?: Record<string, string>; siteName?: string; timeout?: number } = {},
) {
    const stub = stubFetch(replies)
    const config = resolveConfig({ url, fetch: stub.fetch, ...clientOptions })
    const result = send(config, init, options, readJson)
    return { result, requests: stub.requests }
}

/** Settles `promise` and returns its rejection. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        () => {
            throw new Error('expected a rejection')
        },
        (error: unknown) => error,
    )
}

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('send: request', () => {
    it('sends a GET to the site URL and path, and reads the JSON body', async () => {
        const { result, requests } = sendWith([json(200, { message: 'pong' })])
        await expect(result).resolves.toEqual({ message: 'pong' })
        expect(requests).toHaveLength(1)
        expect(only(requests).method).toBe('GET')
        expect(only(requests).url).toBe(`${url}/api/method/frappe.ping`)
        expect(only(requests).headers.get('accept')).toBe('application/json')
    })

    it('adds the query string', async () => {
        const { result, requests } = sendWith([json(200, {})], {
            path: '/api/resource/Task',
            query: { limit_page_length: 20, fields: ['name'] },
        })
        await result
        expect(only(requests).url).toBe(`${url}/api/resource/Task?limit_page_length=20&fields=%5B%22name%22%5D`)
    })

    it('sends a JSON body with its content type', async () => {
        const { result, requests } = sendWith([json(200, {})], {
            method: 'POST',
            path: '/api/resource/Task',
            body: { subject: 'Ship' },
        })
        await result
        expect(only(requests).method).toBe('POST')
        expect(only(requests).headers.get('content-type')).toBe('application/json')
        await expect(only(requests).json()).resolves.toEqual({ subject: 'Ship' })
    })

    it('passes FormData through, so the runtime sets the multipart boundary', async () => {
        const form = new FormData()
        form.set('is_private', '1')
        const { result, requests } = sendWith([json(200, {})], {
            method: 'POST',
            path: '/api/method/upload_file',
            body: form,
        })
        await result
        expect(only(requests).headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/u)
        expect((await only(requests).formData()).get('is_private')).toBe('1')
    })

    it('drops any Content-Type for FormData, even a client-wide one', async () => {
        const form = new FormData()
        form.set('is_private', '1')
        const { result, requests } = sendWith(
            [json(200, {})],
            { method: 'POST', path: '/api/method/upload_file', body: form },
            {},
            { headers: { 'Content-Type': 'application/json' } },
        )
        await result
        expect(only(requests).headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/u)
    })

    it('sends no body and no content type without a body', async () => {
        const { result, requests } = sendWith([json(200, {})], { method: 'DELETE', path: '/api/resource/Task/T-1' })
        await result
        expect(only(requests).body).toBeNull()
        expect(only(requests).headers.has('content-type')).toBe(false)
    })

    it('merges headers case-insensitively: defaults, site name, client, request, JSON content type', async () => {
        const { result, requests } = sendWith(
            [json(200, {})],
            { method: 'PUT', path: '/api/resource/Task/T-1', body: {} },
            { headers: { 'x-request': 'request', 'content-type': 'text/plain' } },
            {
                siteName: 'site1.local',
                headers: { ACCEPT: 'application/vnd+json', 'X-Client': 'client', 'X-Request': 'client' },
            },
        )
        await result
        const headers = Object.fromEntries(only(requests).headers)
        expect(headers).toEqual({
            accept: 'application/vnd+json',
            'x-frappe-site-name': 'site1.local',
            'x-client': 'client',
            'x-request': 'request',
            'content-type': 'application/json',
        })
    })

    it('sends X-Frappe-Site-Name only when configured', async () => {
        const { result, requests } = sendWith([json(200, {})])
        await result
        expect(only(requests).headers.has('x-frappe-site-name')).toBe(false)
    })

    it('looks up the global fetch on every request when none is configured', async () => {
        const config = resolveConfig({ url })
        const stub = stubFetch([json(200, { message: 'late' })])
        vi.stubGlobal('fetch', stub.fetch)
        await expect(send(config, ping, {}, readJson)).resolves.toEqual({ message: 'late' })
        expect(stub.requests).toHaveLength(1)
    })
})

describe('send: requests that cannot be built', () => {
    it.each([
        ['a path without a leading slash', { path: 'api/x' }],
        ['a path with a query', { path: '/api/x?a=1' }],
        ['a path with a ".." segment', { path: '/../admin' }],
        ['a query value JSON cannot encode', { path: '/api/x', query: { filters: { a: 1n } } }],
    ])('rejects %s before calling fetch', async (_case, init: RawRequest) => {
        const { result, requests } = sendWith([], init)
        await expect(result).rejects.toThrow(ConfigurationError)
        expect(requests).toHaveLength(0)
    })

    it.each([
        ['a GET with a body', { path: '/api/x', body: { a: 1 } }, {}],
        ['a body JSON cannot encode', { method: 'POST', path: '/api/x', body: { big: 1n } }, {}],
        ['an invalid header value', ping, { headers: { 'X-A': 'line\nbreak' } }],
        // JSON.stringify would send these as "{}" or as nothing, losing the data without an error.
        ['a Blob body', { method: 'POST', path: '/api/x', body: new Blob(['abc']) }, {}],
        ['an ArrayBuffer body', { method: 'POST', path: '/api/x', body: new ArrayBuffer(3) }, {}],
        ['a Uint8Array body', { method: 'POST', path: '/api/x', body: new Uint8Array([1]) }, {}],
        ['a URLSearchParams body', { method: 'POST', path: '/api/x', body: new URLSearchParams({ a: '1' }) }, {}],
        ['a ReadableStream body', { method: 'POST', path: '/api/x', body: new ReadableStream() }, {}],
        ['a function body', { method: 'POST', path: '/api/x', body: () => 1 }, {}],
        ['a symbol body', { method: 'POST', path: '/api/x', body: Symbol('x') }, {}],
    ] as const)('reports %s as ConfigurationError, with no secret in the message', async (_case, init, options) => {
        const { result, requests } = sendWith([], init, options)
        const error = await rejection(result)
        expect(error).toBeInstanceOf(ConfigurationError)
        expect((error as Error).message).toMatch(/^Invalid request \((GET|POST) https:\/\/example\.com\/api\//u)
        expect((error as Error).message).toMatch(/: check its method, headers and body\.$/u)
        expect((error as Error).message).not.toContain('break')
        expect((error as Error).cause).toBeInstanceOf(TypeError)
        expect(requests).toHaveLength(0)
    })

    // A mistake in the request is reported as one even when the caller has already given up on it.
    it.each([
        ['an invalid path', { path: 'x y' }, {}, 'Request path must start with "/"'],
        ['an invalid timeout', ping, { timeout: -1 }, '`timeout` must be an integer'],
        ['a GET with a body', { path: '/api/x', body: { a: 1 } }, {}, 'Invalid request (GET'],
    ] as const)(
        'reports %s as ConfigurationError even if the signal is already aborted',
        async (_case, init, options, message) => {
            const { result, requests } = sendWith([], init, { ...options, signal: AbortSignal.abort() })
            const error = await rejection(result)
            expect(error).toBeInstanceOf(ConfigurationError)
            expect((error as Error).message).toContain(message)
            expect(requests).toHaveLength(0)
        },
    )

    it.each([-1, 1.5, 2_147_483_648])('rejects the per-request timeout %o', async (timeout) => {
        const { result, requests } = sendWith([], ping, { timeout })
        await expect(result).rejects.toThrow('`timeout` must be an integer number of milliseconds')
        expect(requests).toHaveLength(0)
    })
})

// Fake timers drive the timeout: it is a plain `setTimeout`, so every case is deterministic.
describe('send: timeout and cancellation', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    /** Tracks whether `promise` has settled, without handling its rejection for the test. */
    function track(promise: Promise<unknown>): { settled: () => boolean } {
        let settled = false
        promise.then(
            () => (settled = true),
            () => (settled = true),
        )
        return { settled: () => settled }
    }

    it('never calls fetch when the signal is already aborted', async () => {
        const controller = new AbortController()
        const reason = new Error('navigated away')
        controller.abort(reason)
        const { result, requests } = sendWith([], ping, { signal: controller.signal })
        const error = await rejection(result)
        expect(error).toBeInstanceOf(CancelledError)
        expect(error).toMatchObject({ cause: reason, request: { method: 'GET', url: `${url}/api/method/frappe.ping` } })
        expect(requests).toHaveLength(0)
    })

    it('times out after exactly the default 30 000 ms', async () => {
        const { result } = sendWith([hang])
        const { settled } = track(result)
        await vi.advanceTimersByTimeAsync(29_999)
        expect(settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        const error = await rejection(result)
        expect(error).toBeInstanceOf(TimeoutError)
        expect(error).toMatchObject({
            message: `Request timed out after 30000 ms (GET ${url}/api/method/frappe.ping).`,
            cause: { name: 'TimeoutError' },
        })
    })

    it.each([
        ['the client timeout', {}, { timeout: 5000 }, 5000],
        ['the per-request timeout over the client one', { timeout: 250 }, { timeout: 5000 }, 250],
    ])('uses %s', async (_case, options: RequestOptions, clientOptions, fires) => {
        const { result } = sendWith([hang], ping, options, clientOptions)
        const { settled } = track(result)
        await vi.advanceTimersByTimeAsync(fires - 1)
        expect(settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await expect(result).rejects.toBeInstanceOf(TimeoutError)
    })

    it('reports a timeout even when fetch rejects with a generic AbortError', async () => {
        // Some runtimes reject with `AbortError` whatever the signal's reason was.
        const abortError = (request: Request): Promise<Response> =>
            new Promise((_resolve, reject) => {
                request.signal.addEventListener('abort', () => {
                    reject(new DOMException('This operation was aborted', 'AbortError'))
                })
            })
        const { result } = sendWith([abortError], ping, { timeout: 100 })
        const outcome = rejection(result)
        await vi.advanceTimersByTimeAsync(100)
        expect(await outcome).toBeInstanceOf(TimeoutError)
    })

    it('starts no timer when the timeout is 0', async () => {
        const { result } = sendWith([hang], ping, { timeout: 0 })
        const { settled } = track(result)
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(2_147_483_647)
        expect(settled()).toBe(false)
    })

    it('times out while the body is read', async () => {
        const { result } = sendWith([hangBody], ping, { timeout: 500 })
        const outcome = rejection(result)
        await vi.advanceTimersByTimeAsync(500)
        expect(await outcome).toBeInstanceOf(TimeoutError)
    })

    it('reports a caller abort in flight as CancelledError, with the reason as cause', async () => {
        const controller = new AbortController()
        const reason = new Error('navigated away')
        const { result, requests } = sendWith([hang], ping, { signal: controller.signal })
        expect(requests).toHaveLength(1)
        controller.abort(reason)
        const error = await rejection(result)
        expect(error).toBeInstanceOf(CancelledError)
        expect(error).toMatchObject({
            message: `Request cancelled (GET ${url}/api/method/frappe.ping).`,
            cause: reason,
        })
    })

    it('reports a caller abort while the body is read as CancelledError', async () => {
        const controller = new AbortController()
        const { result } = sendWith([hangBody], ping, { signal: controller.signal })
        controller.abort()
        await expect(result).rejects.toBeInstanceOf(CancelledError)
    })

    it('keeps the first cause: a caller abort after the timeout is still a timeout', async () => {
        const controller = new AbortController()
        const { result } = sendWith([hangBody], ping, { signal: controller.signal, timeout: 100 })
        const outcome = rejection(result)
        await vi.advanceTimersByTimeAsync(100)
        controller.abort()
        expect(await outcome).toBeInstanceOf(TimeoutError)
    })

    it.each([
        ['success', [json(200, {})]],
        ['a status error', [json(404, {})]],
        ['a network error', [new TypeError('fetch failed')]],
    ] as const)('leaves no timer and no caller listener behind after %s', async (_case, replies) => {
        const controller = new AbortController()
        const add = vi.spyOn(controller.signal, 'addEventListener')
        const remove = vi.spyOn(controller.signal, 'removeEventListener')
        await sendWith([...replies], ping, { signal: controller.signal }).result.catch(() => undefined)
        expect(vi.getTimerCount()).toBe(0)
        expect(add).toHaveBeenCalledTimes(1)
        expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1])
    })

    it('leaves no timer behind after a timeout or a cancellation', async () => {
        const timedOut = rejection(sendWith([hang], ping, { timeout: 10 }).result)
        await vi.advanceTimersByTimeAsync(10)
        await timedOut
        const controller = new AbortController()
        const cancelled = rejection(sendWith([hang], ping, { signal: controller.signal }).result)
        controller.abort()
        await cancelled
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('send: failures', () => {
    it('reports a rejected fetch as NetworkError with the original cause', async () => {
        const cause = new TypeError('fetch failed')
        const error = await rejection(sendWith([cause]).result)
        expect(error).toBeInstanceOf(NetworkError)
        expect(error).toMatchObject({
            message: `Network request failed (GET ${url}/api/method/frappe.ping).`,
            cause,
            status: 0,
            request: { method: 'GET', url: `${url}/api/method/frappe.ping` },
        })
    })

    it('reports a fetch that throws synchronously as NetworkError', async () => {
        const cause = new Error('instrumentation bug')
        const config = resolveConfig({
            url,
            fetch: () => {
                throw cause
            },
        })
        const error = await rejection(send(config, ping, {}, readJson))
        expect(error).toBeInstanceOf(NetworkError)
        expect(error).toMatchObject({ cause })
    })

    it('maps a non-2xx response to its error class', async () => {
        const body = {
            exc_type: 'MandatoryError',
            _server_messages: JSON.stringify([JSON.stringify({ message: 'Subject is mandatory' })]),
        }
        const error = await rejection(
            sendWith([json(417, body)], { method: 'POST', path: '/api/resource/Task', body: {} }).result,
        )
        expect(error).toBeInstanceOf(ValidationError)
        expect(error).toMatchObject({ status: 417, exception: 'MandatoryError', message: 'Subject is mandatory' })
    })

    it('maps an HTML error page from a proxy', async () => {
        const error = await rejection(sendWith([text(502, '<title>502 Bad Gateway</title>')]).result)
        expect(error).toBeInstanceOf(ServerError)
        expect(error).toMatchObject({ message: '502 Bad Gateway' })
    })

    it('never puts the query string into an error', async () => {
        const error = await rejection(
            sendWith([json(404, {})], { path: '/api/resource/Task/T-1', query: { token: 'secret' } }).result,
        )
        expect(error).toBeInstanceOf(NotFoundError)
        expect(JSON.stringify(error)).not.toContain('secret')
        expect((error as Error).message).not.toContain('secret')
    })

    it('passes the reader’s own FrappeError through unchanged', async () => {
        const error = await rejection(sendWith([text(200, '<!doctype html>')]).result)
        expect(error).toBeInstanceOf(FrappeError)
        expect(error).toMatchObject({ name: 'FrappeError', status: 200 })
    })
})
