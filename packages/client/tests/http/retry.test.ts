import { getEventListeners } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthStrategy } from '../../src/auth/strategy.js'
import { type ClientOptions, resolveConfig } from '../../src/config.js'
import {
    AbortError,
    FrappeError,
    InvalidArgumentError,
    NetworkError,
    RateLimitError,
    ServerError,
    TimeoutError,
} from '../../src/errors.js'
import { readJson } from '../../src/http/decode.js'
import { retryDelay } from '../../src/http/retry.js'
import { send } from '../../src/http/send.js'
import { createClient, type FrappeClient } from '../../src/index.js'
import type { FrappeRequest, RequestOptions } from '../../src/types.js'
import { hang, json, type Reply, stubFetch, text } from '../support/fetch.js'

const url = 'https://example.com'
const ping = { path: '/api/method/frappe.ping' } as const

/** A failed answer whose message names it, so that the error thrown shows which one it came from. */
const errorResponse = (status: number, message: string, headers: HeadersInit = {}): Response =>
    json(status, { _error_message: message }, headers)

/** The outcome of a request, settled: a rejection is handled at once, while timers are advanced. */
type Outcome = { readonly value: unknown } | { readonly error: unknown }

/** Sends one request through a client with `retry` (default `{}`), answering from `replies`. */
function sendWith(
    replies: Reply[],
    {
        init = ping,
        options = {},
        client = {},
        idempotent = false,
    }: { init?: FrappeRequest; options?: RequestOptions; client?: Partial<ClientOptions>; idempotent?: boolean } = {},
) {
    const stub = stubFetch(replies)
    const config = resolveConfig({ url, fetch: stub.fetch, retry: {}, ...client })
    const outcome: Promise<Outcome> = send(config, init, options, readJson, idempotent).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
    )
    let settled = false
    void outcome.then(() => (settled = true))
    return { outcome, requests: stub.requests, settled: () => settled }
}

/** The error a settled outcome rejected with. */
async function errorOf(outcome: Promise<Outcome>): Promise<unknown> {
    const settled = await outcome
    if (!('error' in settled)) throw new Error('expected a rejection')
    return settled.error
}

// Fake timers make every wait exact and instantaneous; `Math.random` is stubbed for the jitter.
beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
})
afterEach(() => {
    vi.useRealTimers()
})

describe('retry: transient failures', () => {
    it.each([
        [429, RateLimitError],
        [502, ServerError],
        [503, ServerError],
        [504, ServerError],
    ])('retries a %i up to `retries` times, then throws the last failure', async (status, ErrorClass) => {
        const { outcome, requests } = sendWith(
            [errorResponse(status, 'first'), errorResponse(status, 'second'), errorResponse(status, 'third')],
            { client: { retry: { retries: 2 } } },
        )
        await vi.runAllTimersAsync()
        const error = await errorOf(outcome)
        expect(error).toBeInstanceOf(ErrorClass)
        expect(error).toMatchObject({ status, message: 'third' })
        expect(requests).toHaveLength(3)
    })

    it('retries a request that got no response, then throws the last NetworkError', async () => {
        const last = new TypeError('fetch failed: third')
        const { outcome, requests } = sendWith([new TypeError('first'), new TypeError('second'), last])
        await vi.runAllTimersAsync()
        const error = await errorOf(outcome)
        expect(error).toBeInstanceOf(NetworkError)
        expect(error).toMatchObject({ status: 0, cause: last })
        expect(requests).toHaveLength(3)
    })

    it('retries a body that fails while it is read', async () => {
        const broken = new Response(
            new ReadableStream({
                start(controller) {
                    controller.error(new TypeError('terminated'))
                },
            }),
            { status: 200 },
        )
        const { outcome, requests } = sendWith([broken, json(200, { message: 'pong' })])
        await vi.runAllTimersAsync()
        expect(await outcome).toEqual({ value: { message: 'pong' } })
        expect(requests).toHaveLength(2)
    })

    it('resolves once a retry succeeds, and hands over only that answer’s messages', async () => {
        const onServerMessages = vi.fn()
        const messages = (message: string) => JSON.stringify([JSON.stringify({ message })])
        const { outcome, requests } = sendWith(
            [
                json(503, { _server_messages: messages('busy') }),
                new TypeError('fetch failed'),
                json(200, { message: 'pong', _server_messages: messages('done') }),
            ],
            { client: { onServerMessages } },
        )
        await vi.runAllTimersAsync()
        expect(await outcome).toMatchObject({ value: { message: 'pong' } })
        expect(requests).toHaveLength(3)
        expect(onServerMessages).toHaveBeenCalledTimes(1)
        expect(onServerMessages).toHaveBeenCalledWith([{ message: 'done' }], {
            method: 'GET',
            url: `${url}/api/method/frappe.ping`,
        })
    })

    it('sends every retry exactly like the first attempt', async () => {
        const init = { path: '/api/resource/ToDo', query: { limit: 5 } }
        const { outcome, requests } = sendWith([errorResponse(503, 'busy'), json(200, {})], {
            init,
            options: { headers: { 'X-Trace': '1' } },
        })
        await vi.runAllTimersAsync()
        await outcome
        const [first, second] = requests
        expect(second?.url).toBe(first?.url)
        expect(second?.method).toBe('GET')
        expect([...(second?.headers ?? [])]).toEqual([...(first?.headers ?? [])])
    })

    it('retries a POST marked idempotent with the same body', async () => {
        const init: FrappeRequest = { method: 'POST', path: '/api/method/frappe.client.get_list', body: { a: 1 } }
        const { outcome, requests } = sendWith([errorResponse(503, 'busy'), json(200, {})], { init, idempotent: true })
        await vi.runAllTimersAsync()
        await outcome
        expect(requests).toHaveLength(2)
        expect(await requests[1]?.json()).toEqual({ a: 1 })
    })

    it('counts a lower-case get as a GET', async () => {
        const init = { ...ping, method: 'get' } as unknown as FrappeRequest
        const { outcome, requests } = sendWith([errorResponse(503, 'busy'), json(200, {})], { init })
        await vi.runAllTimersAsync()
        await outcome
        expect(requests).toHaveLength(2)
    })
})

describe('retry: failures that are not retried', () => {
    it.each([400, 401, 403, 404, 409, 417, 500, 501, 505])('throws a %i after one attempt', async (status) => {
        const { outcome, requests } = sendWith([errorResponse(status, 'no'), json(200, {})])
        await vi.runAllTimersAsync()
        expect(await errorOf(outcome)).toMatchObject({ status, message: 'no' })
        expect(requests).toHaveLength(1)
    })

    it.each([
        ['POST', { method: 'POST', path: '/api/method/my_app.api.recalculate', body: {} }],
        ['PUT', { method: 'PUT', path: '/api/resource/ToDo/TODO-0001', body: { data: {} } }],
        ['DELETE', { method: 'DELETE', path: '/api/resource/ToDo/TODO-0001' }],
    ] as const)('never retries a %s', async (_method, init) => {
        const { outcome, requests } = sendWith([new TypeError('fetch failed'), json(200, {})], { init })
        await vi.runAllTimersAsync()
        expect(await errorOf(outcome)).toBeInstanceOf(NetworkError)
        expect(requests).toHaveLength(1)
    })

    it('does not retry a timeout', async () => {
        const { outcome, requests } = sendWith([hang, json(200, {})], { options: { timeout: 100 } })
        await vi.advanceTimersByTimeAsync(100)
        await vi.runAllTimersAsync()
        expect(await errorOf(outcome)).toBeInstanceOf(TimeoutError)
        expect(requests).toHaveLength(1)
    })

    it('does not retry a caller abort in flight', async () => {
        const controller = new AbortController()
        const { outcome, requests } = sendWith([hang, json(200, {})], { options: { signal: controller.signal } })
        controller.abort()
        await vi.runAllTimersAsync()
        expect(await errorOf(outcome)).toBeInstanceOf(AbortError)
        expect(requests).toHaveLength(1)
    })

    it('does not retry a 200 that is not JSON', async () => {
        const { outcome, requests } = sendWith([text(200, '<html></html>'), json(200, {})])
        await vi.runAllTimersAsync()
        const error = await errorOf(outcome)
        expect(error).toBeInstanceOf(FrappeError)
        expect(error).toMatchObject({ status: 200 })
        expect(requests).toHaveLength(1)
    })

    it('does not retry a request that cannot be built', async () => {
        const { outcome, requests } = sendWith([], { init: { ...ping, body: {} } })
        expect(await errorOf(outcome)).toBeInstanceOf(InvalidArgumentError)
        expect(requests).toHaveLength(0)
    })

    it('does not retry what a strategy hook throws', async () => {
        const failure = new Error('token store unavailable')
        const auth: AuthStrategy = {
            apply: () => {
                throw failure
            },
        }
        const { outcome, requests } = sendWith([json(200, {})], { client: { auth } })
        await vi.runAllTimersAsync()
        expect(await errorOf(outcome)).toBe(failure)
        expect(requests).toHaveLength(0)
    })

    it.each<[string, (hook: () => never) => AuthStrategy, Reply[]]>([
        ['apply', (hook) => ({ apply: hook }), []],
        ['onResponse', (hook) => ({ apply: () => undefined, onResponse: hook }), [json(200, {})]],
        [
            'onUnauthorized',
            (hook) => ({ apply: () => undefined, onUnauthorized: hook }),
            [errorResponse(401, 'expired')],
        ],
    ])('does not retry a NetworkError that %s throws', async (_hook, strategy, replies) => {
        const failure = new NetworkError('token server unreachable')
        const hook = vi.fn((): never => {
            throw failure
        })
        const { outcome, requests } = sendWith([...replies, json(200, {}), json(200, {})], {
            client: { auth: strategy(hook) },
        })
        await vi.runAllTimersAsync()
        expect(await errorOf(outcome)).toBe(failure)
        expect(hook).toHaveBeenCalledTimes(1)
        expect(requests).toHaveLength(replies.length)
    })

    it.each([
        ['no retry option', {}],
        ['retry: false', { retry: false }],
        ['retries: 0', { retry: { retries: 0 } }],
    ] as const)('tries once with %s', async (_case, client) => {
        const stub = stubFetch([errorResponse(503, 'busy'), json(200, {})])
        const config = resolveConfig({ url, fetch: stub.fetch, ...client })
        await expect(send(config, ping, {}, readJson)).rejects.toBeInstanceOf(ServerError)
        expect(stub.requests).toHaveLength(1)
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('retry: waits', () => {
    it('waits a random time up to a cap that doubles: 150 ms, then 300 ms by default', async () => {
        const { outcome, requests } = sendWith([errorResponse(503, '1'), errorResponse(503, '2'), json(200, {})])
        await vi.advanceTimersByTimeAsync(149)
        expect(requests).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(requests).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(299)
        expect(requests).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(1)
        expect(requests).toHaveLength(3)
        expect(await outcome).toEqual({ value: {} })
    })

    it('never waits longer than maxDelay', async () => {
        const replies = [errorResponse(503, '1'), errorResponse(503, '2'), errorResponse(503, '3'), json(200, {})]
        const { outcome, requests } = sendWith(replies, {
            client: { retry: { retries: 3, baseDelay: 300, maxDelay: 500 } },
        })
        // Caps 300, 500, 500 (not 600, 1200): waits of 150, 250, 250.
        for (const [elapsed, sent] of [
            [149, 1],
            [1, 2],
            [249, 2],
            [1, 3],
            [249, 3],
            [1, 4],
        ] as const) {
            await vi.advanceTimersByTimeAsync(elapsed)
            expect(requests).toHaveLength(sent)
        }
        expect(await outcome).toEqual({ value: {} })
    })

    it('spreads the waits over the whole range', async () => {
        vi.mocked(Math.random).mockReturnValueOnce(0).mockReturnValueOnce(0.999)
        const { outcome, requests } = sendWith([errorResponse(503, '1'), errorResponse(503, '2'), json(200, {})])
        await vi.advanceTimersByTimeAsync(0)
        expect(requests).toHaveLength(2)
        // 0.999 × 600, in whole milliseconds.
        await vi.advanceTimersByTimeAsync(598)
        expect(requests).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(1)
        expect(requests).toHaveLength(3)
        await outcome
    })

    it('waits at most maxDelay, however longFilters retries came before', () => {
        expect(retryDelay({ retries: 2000, baseDelay: 0, maxDelay: 0 }, 1024, 503, undefined)).toBe(0)
        expect(retryDelay({ retries: 2000, baseDelay: 1, maxDelay: 1000 }, 1500, 503, undefined)).toBe(500)
    })

    it('gives each attempt its own time budget; the wait is not timed', async () => {
        const { outcome, requests, settled } = sendWith([errorResponse(503, 'busy'), hang], {
            options: { timeout: 1000 },
        })
        await vi.advanceTimersByTimeAsync(150)
        expect(requests).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(999)
        expect(settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(await errorOf(outcome)).toBeInstanceOf(TimeoutError)
    })

    it('replays a 401 within one try, then retries', async () => {
        const onUnauthorized = vi.fn(() => Promise.resolve(true))
        const auth: AuthStrategy = { apply: () => undefined, onUnauthorized }
        const { outcome, requests } = sendWith(
            [errorResponse(401, 'expired'), errorResponse(503, 'busy'), json(200, {})],
            {
                client: { auth },
            },
        )
        await vi.runAllTimersAsync()
        expect(await outcome).toEqual({ value: {} })
        expect(requests).toHaveLength(3)
        expect(onUnauthorized).toHaveBeenCalledTimes(1)
    })
})

describe('retry: Retry-After', () => {
    it.each([
        ['seconds on a 429', 429, '2', 2000],
        ['seconds on a 503', 503, '3', 3000],
        ['exactly maxDelay', 429, '10', 10_000],
        ['a date on a 503', 503, 'Thu, 01 Jan 2026 00:00:04 GMT', 4000],
    ])('waits exactly for %s', async (_case, status, header, wait) => {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        const { outcome, requests } = sendWith([
            errorResponse(status, 'wait', { 'retry-after': header }),
            json(200, {}),
        ])
        await vi.advanceTimersByTimeAsync(wait - 1)
        expect(requests).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(requests).toHaveLength(2)
        expect(await outcome).toEqual({ value: {} })
    })

    it('retries at once for a Retry-After of 0', async () => {
        const { outcome, requests } = sendWith([errorResponse(429, 'wait', { 'retry-after': '0' }), json(200, {})])
        await vi.advanceTimersByTimeAsync(0)
        expect(requests).toHaveLength(2)
        expect(await outcome).toEqual({ value: {} })
    })

    it.each([
        ['on a 502', 502, '5'],
        ['on a 504', 504, '5'],
        ['that cannot be read', 429, 'soon'],
    ])('uses the backoff for a Retry-After %s', async (_case, status, header) => {
        const { outcome, requests } = sendWith([
            errorResponse(status, 'wait', { 'retry-after': header }),
            json(200, {}),
        ])
        await vi.advanceTimersByTimeAsync(149)
        expect(requests).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(requests).toHaveLength(2)
        await outcome
    })

    it('throws at once when Retry-After is longer than maxDelay', async () => {
        const { outcome, requests, settled } = sendWith([
            errorResponse(429, 'slow down', { 'retry-after': '11' }),
            json(200, {}),
        ])
        await vi.advanceTimersByTimeAsync(0)
        expect(settled()).toBe(true)
        const error = await errorOf(outcome)
        expect(error).toBeInstanceOf(RateLimitError)
        expect(error).toMatchObject({ retryAfter: 11_000, message: 'slow down' })
        expect(requests).toHaveLength(1)
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('retry: aborts', () => {
    it('rejects at once when the caller aborts during a wait, leaving no timer or listener', async () => {
        const controller = new AbortController()
        const reason = new Error('navigated away')
        const { outcome, requests } = sendWith([errorResponse(503, 'busy'), json(200, {})], {
            options: { signal: controller.signal },
        })
        await vi.advanceTimersByTimeAsync(100)
        expect(vi.getTimerCount()).toBe(1)
        controller.abort(reason)
        const error = await errorOf(outcome)
        expect(error).toBeInstanceOf(AbortError)
        expect(error).toMatchObject({ cause: reason, request: { method: 'GET', url: `${url}/api/method/frappe.ping` } })
        expect(requests).toHaveLength(1)
        expect(vi.getTimerCount()).toBe(0)
        expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    })

    it('does not wait when the caller aborted while the failure was read', async () => {
        const controller = new AbortController()
        const abortThenFail = (): Response => {
            controller.abort()
            return errorResponse(503, 'busy')
        }
        const { outcome, requests, settled } = sendWith([abortThenFail, json(200, {})], {
            options: { signal: controller.signal },
        })
        await vi.advanceTimersByTimeAsync(0)
        expect(settled()).toBe(true)
        expect(await errorOf(outcome)).toBeInstanceOf(AbortError)
        expect(requests).toHaveLength(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('removes its listener from the caller’s signal after a wait', async () => {
        const controller = new AbortController()
        const { outcome } = sendWith([errorResponse(503, 'busy'), json(200, {})], {
            options: { signal: controller.signal },
        })
        await vi.runAllTimersAsync()
        expect(await outcome).toEqual({ value: {} })
        expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    })
})

describe('retry: only reads, through every method of the client', () => {
    const longFilters = {
        name: ['in', Array.from({ length: 400 }, (_, index) => `TODO-${String(index).padStart(5, '0')}`)] as const,
    }
    const longName = 'x'.repeat(4000)
    // Accepted by `request()`'s type: TypeScript checks excess properties only on a literal.
    const markedPost = {
        method: 'POST',
        path: '/api/method/my_app.api.create_order',
        body: {},
        idempotent: true,
    } as const

    /** Runs `call` on a client that retries once without waiting; every answer is a `503`. */
    async function requestsOf(call: (frappe: FrappeClient) => Promise<unknown>): Promise<Request[]> {
        vi.mocked(Math.random).mockReturnValue(0)
        const { fetch, requests } = stubFetch([
            errorResponse(503, 'busy'),
            errorResponse(503, 'busy'),
            errorResponse(503, 'busy'),
        ])
        const frappe = createClient({ url, fetch, retry: { retries: 1 } })
        const result = call(frappe).then(
            () => undefined,
            (error: unknown) => error,
        )
        await vi.runAllTimersAsync()
        expect(await result).toBeInstanceOf(ServerError)
        return requests
    }

    it.each<[string, 'GET' | 'POST', (frappe: FrappeClient) => Promise<unknown>]>([
        ['request() GET', 'GET', (frappe) => frappe.request(ping)],
        ['call.get', 'GET', (frappe) => frappe.call.get('frappe.ping')],
        ['doc.get', 'GET', (frappe) => frappe.doc.get('ToDo', 'TODO-0001')],
        ['doc.getSingle', 'GET', (frappe) => frappe.doc.getSingle('System Settings')],
        ['doc.getList', 'GET', (frappe) => frappe.doc.getList('ToDo')],
        ['doc.getList, too long for a URL', 'POST', (frappe) => frappe.doc.getList('ToDo', { filters: longFilters })],
        ['doc.paginate', 'GET', (frappe) => frappe.doc.paginate('ToDo').next()],
        ['doc.count', 'GET', (frappe) => frappe.doc.count('ToDo')],
        ['doc.count, too long for a URL', 'POST', (frappe) => frappe.doc.count('ToDo', longFilters)],
        ['doc.getValue', 'GET', (frappe) => frappe.doc.getValue('ToDo', 'TODO-0001', 'status')],
        ['doc.getValue, too long for a URL', 'POST', (frappe) => frappe.doc.getValue('ToDo', longFilters, 'status')],
        ['doc.exists, too long for a URL', 'POST', (frappe) => frappe.doc.exists('ToDo', longFilters)],
        ['doc.validateLink, too long for a URL', 'POST', (frappe) => frappe.doc.validateLink('ToDo', longName)],
        ['doc.getSingleValue', 'GET', (frappe) => frappe.doc.getSingleValue('System Settings', 'country')],
        ['doc.getSingleValue, too long for a URL', 'POST', (frappe) => frappe.doc.getSingleValue(longName, 'country')],
        ['doc.hasPermission, too long for a URL', 'POST', (frappe) => frappe.doc.hasPermission('ToDo', longName)],
        [
            'doc.getPassword, too long for a URL',
            'POST',
            (frappe) => frappe.doc.getPassword('Email Account', longName, 'password'),
        ],
        ['doc.isAmended', 'POST', (frappe) => frappe.doc.isAmended('Sales Invoice', 'SINV-0001')],
        ['auth.getLoggedUser', 'GET', (frappe) => frappe.auth.getLoggedUser()],
        ['file.download', 'GET', (frappe) => frappe.file.download('/files/invoice.pdf')],
    ])('retries %s', async (_case, method, call) => {
        const requests = await requestsOf(call)
        expect(requests.map((request) => request.method)).toEqual([method, method])
    })

    it.each<[string, 'POST' | 'PUT' | 'DELETE', (frappe: FrappeClient) => Promise<unknown>]>([
        ['request() POST', 'POST', (frappe) => frappe.request({ method: 'POST', path: ping.path, body: {} })],
        ['request() POST with an `idempotent` property', 'POST', (frappe) => frappe.request(markedPost)],
        ['request() PUT', 'PUT', (frappe) => frappe.request({ method: 'PUT', path: '/api/resource/ToDo/TODO-0001' })],
        ['request() DELETE', 'DELETE', (frappe) => frappe.request({ method: 'DELETE', path: '/api/resource/ToDo/A' })],
        ['call.post', 'POST', (frappe) => frappe.call.post('my_app.api.recalculate', { name: 'SO-0001' })],
        ['doc.insert', 'POST', (frappe) => frappe.doc.insert('ToDo', { description: 'Ship' })],
        ['doc.insertMany', 'POST', (frappe) => frappe.doc.insertMany('ToDo', [{ description: 'Ship' }])],
        ['doc.setValue', 'PUT', (frappe) => frappe.doc.setValue('ToDo', 'TODO-0001', { status: 'Closed' })],
        ['doc.rename', 'POST', (frappe) => frappe.doc.rename('ToDo', 'TODO-0001', 'TODO-0002')],
        ['doc.delete', 'DELETE', (frappe) => frappe.doc.delete('ToDo', 'TODO-0001')],
        ['doc.submit', 'PUT', (frappe) => frappe.doc.submit('Sales Invoice', 'SINV-0001')],
        ['doc.cancel', 'PUT', (frappe) => frappe.doc.cancel('Sales Invoice', 'SINV-0001')],
        [
            'doc.runMethod',
            'POST',
            (frappe) => frappe.doc.runMethod('ToDo', 'TODO-0001', 'add_comment', { text: 'Checked' }),
        ],
        ['file.upload', 'POST', (frappe) => frappe.file.upload(new Blob(['x']), { fileName: 'a.txt' })],
        ['auth.login', 'POST', (frappe) => frappe.auth.login({ username: 'user', password: 'secret' })],
        ['auth.logout', 'POST', (frappe) => frappe.auth.logout()],
    ])('never retries %s', async (_case, method, call) => {
        const requests = await requestsOf(call)
        expect(requests.map((request) => request.method)).toEqual([method])
    })
})
