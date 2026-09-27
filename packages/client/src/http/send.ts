// The request pipeline, and the only place that calls `fetch`: headers, body, authentication,
// timeout, aborts, and every failure mapped to a typed error.

import type { AuthStrategy } from '../auth/strategy.js'
import {
    AbortError,
    FrappeError,
    type FrappeRequestContext,
    InvalidArgumentError,
    NetworkError,
    TimeoutError,
} from '../errors.js'
import type { FrappeRequest, RequestOptions } from '../types.js'
import { toError } from './decode.js'
import { SafeHeaders } from './headers.js'
import { buildUrl } from './url.js'

/** Validated client options: what the pipeline needs to send a request. */
export interface ResolvedConfig {
    /** `origin + path` of the site, without a trailing slash. */
    readonly url: string
    readonly headers: Readonly<Record<string, string>>
    /** Milliseconds; `0` disables the timeout. */
    readonly timeout: number
    readonly siteName: string | undefined
    /** `undefined` means the global `fetch`, looked up on every request. */
    readonly fetch: ((request: Request) => Promise<Response>) | undefined
    /** How requests authenticate; `undefined` sends them as Guest. */
    readonly auth: AuthStrategy | undefined
}

/** Reads a successful response. Runs inside the pipeline's failure classification. */
export type ReadResponse<T> = (response: Response, context: FrappeRequestContext) => Promise<T>

/** The pipeline bound to one client's config, as resources use it. */
export type Send = <T>(init: FrappeRequest, options: RequestOptions, read: ReadResponse<T>) => Promise<T>

/** Headers and body, built once per call, so that a replay sends exactly the same body. */
interface PreparedRequest {
    readonly headers: Headers
    readonly body: BodyInit | null
}

/** One attempt's outcome: the value read from a 2xx response, or the non-2xx response and its body. */
type Attempt<T> =
    { readonly value: T } | { readonly request: Request; readonly response: Response; readonly text: string }

/** The largest delay `setTimeout` supports; above it, timers fire after 1 ms. */
const MAX_TIMEOUT = 2_147_483_647

/** Checks a timeout: an integer number of milliseconds, `0` (disabled) up to about 24.8 days. */
export function assertTimeout(value: unknown, what: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_TIMEOUT) {
        throw new InvalidArgumentError(
            `${what} must be an integer number of milliseconds from 0 to ${String(MAX_TIMEOUT)}; got ${String(value)}.`,
        )
    }
    return value
}

/**
 * Sends one request and reads its response with `read`.
 *
 * Throws `InvalidArgumentError` for a request that cannot be built, `AbortError` when the
 * caller's signal aborts (also while a strategy hook is pending), `TimeoutError` when an attempt's
 * time budget runs out (also while the body is read), `NetworkError` when no response arrives, and
 * the matching status error for a non-2xx response. A `401` is sent once more when the strategy's
 * `onUnauthorized` resolves `true`; what the strategy's hooks throw reaches the caller unchanged.
 */
export async function send<T>(
    config: ResolvedConfig,
    init: FrappeRequest,
    options: RequestOptions,
    read: ReadResponse<T>,
): Promise<T> {
    // The request is checked in full first: a mistake in it is an `InvalidArgumentError` even when
    // the caller has already aborted.
    const method = normalizeMethod(init)
    const url = buildUrl(config.url, init.path, init.query)
    const context: FrappeRequestContext = { method, url: config.url + init.path }
    const timeout = options.timeout === undefined ? config.timeout : assertTimeout(options.timeout, '`timeout`')
    const prepared = prepare(config, init, options, context)

    const first = await attempt(config, prepared, options, read, url, context, timeout)
    if ('value' in first) return first.value
    const { auth } = config
    const { signal: callerSignal } = options
    let last: Attempt<T> = first
    if (first.response.status === 401 && auth?.onUnauthorized !== undefined) {
        // Outside any time budget: renewing credentials is the strategy's own work. The caller can
        // still abort it, and an aborted request never asks for new credentials.
        throwIfAborted(callerSignal, context)
        const renewed: unknown = await unlessAborted(auth.onUnauthorized(first.request), callerSignal, context)
        // Only `true` replays: a strategy written in JavaScript may resolve anything.
        if (renewed === true) last = await attempt(config, prepared, options, read, url, context, timeout)
    }
    if ('value' in last) return last.value
    throw toError(last.response, last.text, context)
}

/**
 * The method, upper-cased: `fetch` upper-cases only the standard methods, so `patch` would be sent
 * as it is, and a strategy would see `post` where it checks for `POST`.
 */
function normalizeMethod(init: FrappeRequest): string {
    const { method = 'GET' } = init as { method?: unknown }
    if (typeof method !== 'string') throw new InvalidArgumentError('Request method must be a string, such as "POST".')
    return method.toUpperCase()
}

/**
 * One attempt, with its own time budget: the strategy's headers, the `Request`, `fetch`, and the
 * body read. Failures to get a response are classified here; a non-2xx response is returned with
 * its body, for `send` to decide.
 */
async function attempt<T>(
    config: ResolvedConfig,
    prepared: PreparedRequest,
    options: RequestOptions,
    read: ReadResponse<T>,
    url: string,
    context: FrappeRequestContext,
    timeout: number,
): Promise<Attempt<T>> {
    const { auth } = config
    const { signal: callerSignal } = options
    // An aborted request never asks the strategy for credentials.
    throwIfAborted(callerSignal, context)
    const headers = new SafeHeaders(prepared.headers)
    // Before the timer: the time budget is the server's, not the strategy's. Awaited only when it
    // returns a promise, so a request without an async strategy is sent in the same tick.
    const applied = auth?.apply(headers, context.method)
    if (applied !== undefined) await unlessAborted(applied, callerSignal, context)

    // One controller per attempt, aborted by the timer or the caller. Both are released in
    // `finally`, so nothing outlives the attempt: no timer, and no listener on a long-lived
    // caller signal.
    const controller = new AbortController()
    const request = createRequest(url, headers, prepared.body, auth?.credentials, controller.signal, context)
    // Checked again: `apply` itself may have aborted it, and an aborted signal fires no more events.
    throwIfAborted(callerSignal, context)
    const deadline =
        timeout === 0 ? undefined : new DOMException(`Timed out after ${String(timeout)} ms.`, 'TimeoutError')
    const timer =
        deadline === undefined
            ? undefined
            : setTimeout(() => {
                  controller.abort(deadline)
              }, timeout)
    const forwardAbort = (): void => {
        controller.abort(callerSignal?.reason)
    }
    callerSignal?.addEventListener('abort', forwardAbort, { once: true })

    const classify = (cause: unknown): FrappeError => {
        if (cause instanceof FrappeError) return cause
        // Our own signal decides, not the error's name: runtimes disagree on what fetch rejects with.
        const { signal } = controller
        const reason: unknown = signal.reason
        if (signal.aborted && reason === deadline) {
            return new TimeoutError(`Request timed out after ${String(timeout)} ms (${describeRequest(context)}).`, {
                cause,
                request: context,
            })
        }
        if (signal.aborted) {
            return new AbortError(`Request aborted (${describeRequest(context)}).`, { cause: reason, request: context })
        }
        return new NetworkError(`Network request failed (${describeRequest(context)}).`, { cause, request: context })
    }

    try {
        let response: Response
        try {
            response = await (config.fetch === undefined ? globalThis.fetch(request) : config.fetch(request))
        } catch (cause) {
            throw classify(cause)
        }
        // Outside the classification: a response arrived, so what the hook throws is its own.
        auth?.onResponse?.(response)
        try {
            if (!response.ok) return { request, response, text: await response.text() }
            return { value: await read(response, context) }
        } catch (cause) {
            throw classify(cause)
        }
    } finally {
        clearTimeout(timer)
        callerSignal?.removeEventListener('abort', forwardAbort)
    }
}

/** Throws `AbortError` when the caller has already aborted: the attempt is not sent. */
function throwIfAborted(callerSignal: AbortSignal | undefined, context: FrappeRequestContext): void {
    if (callerSignal?.aborted === true) throw abortedBeforeSending(callerSignal, context)
}

/**
 * Waits for a strategy hook only while the caller still wants the response: an abort rejects at
 * once, and whatever the hook settles with later is ignored.
 */
async function unlessAborted<R>(
    pending: R | PromiseLike<R>,
    callerSignal: AbortSignal | undefined,
    context: FrappeRequestContext,
): Promise<R> {
    if (callerSignal === undefined) return pending
    // The hook may itself have aborted the signal, which then fires no more events.
    throwIfAborted(callerSignal, context)
    // Aborted once the hook settles, which removes the listener from the caller's signal.
    const settled = new AbortController()
    const aborted = new Promise<never>((_resolve, reject) => {
        const rejectAborted = (): void => {
            reject(abortedBeforeSending(callerSignal, context))
        }
        callerSignal.addEventListener('abort', rejectAborted, { once: true, signal: settled.signal })
    })
    try {
        return await Promise.race([pending, aborted])
    } finally {
        settled.abort()
    }
}

function abortedBeforeSending(callerSignal: AbortSignal, context: FrappeRequestContext): AbortError {
    return new AbortError(`Request aborted before it was sent (${describeRequest(context)}).`, {
        cause: callerSignal.reason,
        request: context,
    })
}

/**
 * Builds the headers and the body. Headers, later entries winning: `Accept`,
 * `X-Frappe-Site-Name`, the client's headers, the request's headers, then the body's content type.
 * The strategy's headers are added on top for each attempt.
 */
function prepare(
    config: ResolvedConfig,
    init: FrappeRequest,
    options: RequestOptions,
    context: FrappeRequestContext,
): PreparedRequest {
    try {
        const headers = new SafeHeaders({ Accept: 'application/json' })
        if (config.siteName !== undefined) headers.set('X-Frappe-Site-Name', config.siteName)
        for (const [name, value] of Object.entries(config.headers)) headers.set(name, value)
        for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value)
        let body: BodyInit | null = null
        // Checked here, not only by the Request constructor, so that it is reported even when the
        // caller has already aborted.
        if (init.body !== undefined && (context.method === 'GET' || context.method === 'HEAD')) {
            throw new TypeError(`A ${context.method} request cannot have a body.`)
        }
        if (init.body instanceof FormData) {
            // The runtime sets `multipart/form-data` with its boundary; any other value breaks it.
            headers.delete('Content-Type')
            body = init.body
        } else if (init.body !== undefined) {
            body = jsonBody(init.body)
            headers.set('Content-Type', 'application/json')
        }
        return { headers, body }
    } catch (cause) {
        throw invalidRequest(cause, context)
    }
}

/** Builds one attempt's `Request`. */
function createRequest(
    url: string,
    headers: Headers,
    body: BodyInit | null,
    credentials: AuthStrategy['credentials'],
    signal: AbortSignal,
    context: FrappeRequestContext,
): Request {
    try {
        return new Request(url, {
            method: context.method,
            headers,
            body,
            signal,
            ...(credentials === undefined ? {} : { credentials }),
        })
    } catch (cause) {
        throw invalidRequest(cause, context)
    }
}

/**
 * Keeps the runtime's error in `cause`: it names the problem, and never quotes a header value, since
 * every header is set through `SafeHeaders`.
 */
function invalidRequest(cause: unknown, context: FrappeRequestContext): InvalidArgumentError {
    return new InvalidArgumentError(
        `Invalid request (${describeRequest(context)}): check its method, headers and body.`,
        {
            cause,
            request: context,
        },
    )
}

/**
 * The body as JSON. Refuses what `JSON.stringify` would lose without an error: the other `fetch`
 * body types become `{}`, and a function or a symbol becomes no body at all.
 */
function jsonBody(value: unknown): string {
    if (
        value instanceof Blob ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value) ||
        value instanceof URLSearchParams ||
        value instanceof ReadableStream
    ) {
        throw new TypeError('Only plain values (sent as JSON) and FormData can be sent as a body.')
    }
    const json = JSON.stringify(value) as string | undefined
    if (json === undefined) throw new TypeError('The body cannot be encoded as JSON.')
    return json
}

/** The request, for a message: its method, and the URL origin and path. */
function describeRequest(context: FrappeRequestContext): string {
    return `${context.method} ${context.url}`
}
