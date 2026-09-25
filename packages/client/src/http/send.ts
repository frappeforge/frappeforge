// The request pipeline, and the only place that calls `fetch`: headers, body, timeout,
// cancellation, and every failure mapped to a typed error.

import {
    CancelledError,
    ConfigurationError,
    FrappeError,
    type FrappeRequestContext,
    NetworkError,
    TimeoutError,
} from '../errors.js'
import type { RawRequest, RequestOptions } from '../types.js'
import { toError } from './decode.js'
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
}

/** Reads a successful response. Runs inside the pipeline's failure classification. */
type ReadResponse<T> = (response: Response, context: FrappeRequestContext) => Promise<T>

/** The largest delay `setTimeout` supports; above it, timers fire after 1 ms. */
const MAX_TIMEOUT = 2_147_483_647

/** Checks a timeout: an integer number of milliseconds, `0` (disabled) up to about 24.8 days. */
export function assertTimeout(value: unknown, what: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_TIMEOUT) {
        throw new ConfigurationError(
            `${what} must be an integer number of milliseconds from 0 to ${String(MAX_TIMEOUT)}; got ${String(value)}.`,
        )
    }
    return value
}

/**
 * Sends one request and reads its response with `read`.
 *
 * Throws `ConfigurationError` for a request that cannot be built, `CancelledError` when the
 * caller's signal aborts, `TimeoutError` when the time budget runs out (also while the body is
 * read), `NetworkError` when no response arrives, and the matching status error for a non-2xx
 * response.
 */
export async function send<T>(
    config: ResolvedConfig,
    init: RawRequest,
    options: RequestOptions,
    read: ReadResponse<T>,
): Promise<T> {
    // The request is checked in full first: a mistake in it is a `ConfigurationError` even when the
    // caller has already cancelled.
    const url = buildUrl(config.url, init.path, init.query)
    const context: FrappeRequestContext = { method: init.method ?? 'GET', url: config.url + init.path }
    const timeout = options.timeout === undefined ? config.timeout : assertTimeout(options.timeout, '`timeout`')

    // One controller per request, aborted by the timer or the caller. Both are released in
    // `finally`, so nothing outlives the request: no timer, and no listener on a long-lived
    // caller signal.
    const controller = new AbortController()
    const request = createRequest(config, init, options, url, controller.signal, context)
    const { signal: caller } = options
    if (caller?.aborted === true) {
        throw new CancelledError(`Request cancelled before it was sent (${target(context)}).`, {
            cause: caller.reason,
            request: context,
        })
    }
    const deadline =
        timeout === 0 ? undefined : new DOMException(`Timed out after ${String(timeout)} ms.`, 'TimeoutError')
    const timer =
        deadline === undefined
            ? undefined
            : setTimeout(() => {
                  controller.abort(deadline)
              }, timeout)
    const cancel = (): void => {
        controller.abort(caller?.reason)
    }
    caller?.addEventListener('abort', cancel, { once: true })

    try {
        const response = await (config.fetch === undefined ? globalThis.fetch(request) : config.fetch(request))
        if (!response.ok) throw toError(response, await response.text(), context)
        return await read(response, context)
    } catch (cause) {
        if (cause instanceof FrappeError) throw cause
        // Our own signal decides, not the error's name: runtimes disagree on what fetch rejects with.
        const { signal } = controller
        const reason: unknown = signal.reason
        if (signal.aborted && reason === deadline) {
            throw new TimeoutError(`Request timed out after ${String(timeout)} ms (${target(context)}).`, {
                cause,
                request: context,
            })
        }
        if (signal.aborted) {
            throw new CancelledError(`Request cancelled (${target(context)}).`, { cause: reason, request: context })
        }
        throw new NetworkError(`Network request failed (${target(context)}).`, { cause, request: context })
    } finally {
        clearTimeout(timer)
        caller?.removeEventListener('abort', cancel)
    }
}

/**
 * Builds the `Request`. Headers, later entries winning: `Accept`, `X-Frappe-Site-Name`, the
 * client's headers, the request's headers, then the body's content type.
 */
function createRequest(
    config: ResolvedConfig,
    init: RawRequest,
    options: RequestOptions,
    url: string,
    signal: AbortSignal,
    context: FrappeRequestContext,
): Request {
    try {
        const headers = new Headers({ Accept: 'application/json' })
        if (config.siteName !== undefined) headers.set('X-Frappe-Site-Name', config.siteName)
        for (const [name, value] of Object.entries(config.headers)) headers.set(name, value)
        for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value)
        let body: BodyInit | null = null
        if (init.body instanceof FormData) {
            // The runtime sets `multipart/form-data` with its boundary; any other value breaks it.
            headers.delete('Content-Type')
            body = init.body
        } else if (init.body !== undefined) {
            body = jsonBody(init.body)
            headers.set('Content-Type', 'application/json')
        }
        return new Request(url, { method: context.method, headers, body, signal })
    } catch (cause) {
        // The runtime's message can quote a header value, such as a token, so it stays in `cause`.
        throw new ConfigurationError(`Invalid request (${target(context)}): check its method, headers and body.`, {
            cause,
            request: context,
        })
    }
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

function target(context: FrappeRequestContext): string {
    return `${context.method} ${context.url}`
}
