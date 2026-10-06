// The request pipeline, and the only place that calls `fetch`: headers, body, authentication,
// timeout, aborts, retries, and every failure mapped to a typed error.

import type { AuthStrategy } from '../auth/strategy.js'
import {
    AbortError,
    FrappeError,
    type FrappeRequestContext,
    InvalidArgumentError,
    NetworkError,
    type ServerMessage,
    TimeoutError,
} from '../errors.js'
import type { FrappeRequest, RequestOptions } from '../types.js'
import { parseRetryAfter, toError } from './decode.js'
import { SafeHeaders } from './headers.js'
import { type ResolvedRetry, retryDelay, sleep } from './retry.js'
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
    /** Receives the messages of successful answers. */
    readonly onServerMessages: ((messages: readonly ServerMessage[], request: FrappeRequestContext) => void) | undefined
    /** How reads are retried; `undefined` tries each request once. */
    readonly retry: ResolvedRetry | undefined
}

/**
 * Reads a successful response. Runs inside the pipeline's failure classification. A reader of
 * JSON passes `messages` to `readJson`, which adds the answer's messages to it; they reach
 * `onServerMessages` only when the reader resolves.
 */
export type ReadResponse<T> = (
    response: Response,
    context: FrappeRequestContext,
    messages: ServerMessage[],
) => Promise<T>

/**
 * The pipeline bound to one client's config, as resources use it. `idempotent` marks a POST that
 * only reads, such as a list sent as a POST because its query is too long for a URL: it is retried
 * like a GET. An argument, not a property of `init`, so that no request a caller builds carries it.
 */
export type Send = <T>(
    init: FrappeRequest,
    options: RequestOptions,
    read: ReadResponse<T>,
    idempotent?: boolean,
) => Promise<T>

/** Headers and body, built once per call, so that a replay sends exactly the same body. */
interface PreparedRequest {
    readonly headers: Headers
    readonly body: BodyInit | null
}

/**
 * One attempt's outcome: the value read from a 2xx response with the answer's messages, the
 * non-2xx response and its body, or the failure of a request that got no response.
 */
type Attempt<T> =
    | { readonly value: T; readonly messages: readonly ServerMessage[] }
    | { readonly request: Request; readonly response: Response; readonly text: string }
    | { readonly error: NetworkError }

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
 * caller's signal aborts (also while a strategy hook is pending, or between retries),
 * `TimeoutError` when an attempt's time budget runs out (also while the body is read),
 * `NetworkError` when no response arrives, and the matching status error for a non-2xx response.
 * A `401` is sent once more when the strategy's `onUnauthorized` resolves `true`; what the
 * strategy's hooks throw reaches the caller unchanged. With `retry` configured, a `GET` or an
 * `idempotent` POST that got no response, a `429`, `502`, `503` or `504` is tried again; the last
 * failure is thrown unchanged.
 */
export async function send<T>(
    config: ResolvedConfig,
    init: FrappeRequest,
    options: RequestOptions,
    read: ReadResponse<T>,
    idempotent = false,
): Promise<T> {
    // The request is checked in full first: a mistake in it is an `InvalidArgumentError` even when
    // the caller has already aborted.
    const method = normalizeMethod(init)
    const url = buildUrl(config.url, init.path, init.query)
    const context: FrappeRequestContext = { method, url: config.url + init.path }
    const timeout = options.timeout === undefined ? config.timeout : assertTimeout(options.timeout, '`timeout`')
    const prepared = prepare(config, init, options, context)
    // Only reads are retried: a write whose answer was lost may have been applied, and Frappe
    // runs its hooks again on every repeat.
    const retry = method === 'GET' || idempotent ? config.retry : undefined

    for (let retryCount = 0; ; retryCount += 1) {
        // A timeout, an abort, and what a reader or a strategy hook throws are thrown from here:
        // never retried.
        const outcome = await attemptWithReplay(config, prepared, options, read, url, context, timeout)
        if ('value' in outcome) {
            deliverMessages(config, outcome.messages, context)
            return outcome.value
        }
        const failure = 'error' in outcome ? outcome.error : toError(outcome.response, outcome.text, context)
        const retryAfter =
            'response' in outcome ? parseRetryAfter(outcome.response.headers.get('retry-after')) : undefined
        const delay = retry === undefined ? undefined : retryDelay(retry, retryCount, failure.status, retryAfter)
        if (delay === undefined) throw failure
        // Returns early when the caller aborts: the next attempt then rejects with `AbortError`.
        await sleep(delay, options.signal)
    }
}

/**
 * One try: an attempt, and the replay after a `401` when the strategy renewed its credentials.
 * Returns the last attempt's outcome.
 */
async function attemptWithReplay<T>(
    config: ResolvedConfig,
    prepared: PreparedRequest,
    options: RequestOptions,
    read: ReadResponse<T>,
    url: string,
    context: FrappeRequestContext,
    timeout: number,
): Promise<Attempt<T>> {
    const first = await attempt(config, prepared, options, read, url, context, timeout)
    const { auth } = config
    if (!('response' in first) || first.response.status !== 401 || auth?.onUnauthorized === undefined) return first
    // Outside any time budget: renewing credentials is the strategy's own work. The caller can
    // still abort it, and an aborted request never asks for new credentials.
    const { signal: callerSignal } = options
    throwIfAborted(callerSignal, context)
    const renewed: unknown = await unlessAborted(auth.onUnauthorized(first.request), callerSignal, context)
    // Only `true` replays: a strategy written in JavaScript may resolve anything.
    return renewed === true ? attempt(config, prepared, options, read, url, context, timeout) : first
}

/**
 * Hands the messages of a successful answer to `onServerMessages`, when there are any. What the
 * callback throws is thrown again from a microtask: the application sees it as an uncaught
 * error, but the request still resolves, so a bug in a toast never loses saved data.
 */
function deliverMessages(
    config: ResolvedConfig,
    messages: readonly ServerMessage[],
    context: FrappeRequestContext,
): void {
    const { onServerMessages } = config
    if (onServerMessages === undefined || messages.length === 0) return
    try {
        onServerMessages(messages, context)
    } catch (error) {
        queueMicrotask(() => {
            throw error
        })
    }
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
 * body read. Failures to get a response are classified here: a timeout or an abort is thrown, and
 * a network failure is returned, as is a non-2xx response with its body, for `send` to decide.
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

    // What a reader (or a custom `fetch`) throws as a `FrappeError` is its own, and thrown as it is.
    const failedAttempt = (cause: unknown): Attempt<T> => {
        if (cause instanceof FrappeError) throw cause
        // Our own signal decides, not the error's name: runtimes disagree on what fetch rejects with.
        const { signal } = controller
        const reason: unknown = signal.reason
        if (signal.aborted && reason === deadline) {
            throw new TimeoutError(`Request timed out after ${String(timeout)} ms (${describeRequest(context)}).`, {
                cause,
                request: context,
            })
        }
        if (signal.aborted) {
            throw new AbortError(`Request aborted (${describeRequest(context)}).`, { cause: reason, request: context })
        }
        return {
            error: new NetworkError(`Network request failed (${describeRequest(context)}).`, {
                cause,
                request: context,
            }),
        }
    }

    try {
        let response: Response
        try {
            response = await (config.fetch === undefined ? globalThis.fetch(request) : config.fetch(request))
        } catch (cause) {
            return failedAttempt(cause)
        }
        // Outside the classification: a response arrived, so what the hook throws is its own.
        auth?.onResponse?.(response)
        try {
            if (!response.ok) return { request, response, text: await response.text() }
            const messages: ServerMessage[] = []
            return { value: await read(response, context, messages), messages }
        } catch (cause) {
            return failedAttempt(cause)
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
