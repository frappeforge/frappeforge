/**
 * One message from Frappe's `_server_messages` envelope — the text a Desk user would have
 * seen in a dialog.
 */
export interface ServerMessage {
    /** The message text, with any HTML left as the server sent it. */
    message: string
    /** Dialog title, when the server set one. */
    title?: string
    /** Severity hint used by Desk, such as `red` or `orange`. */
    indicator?: string
}

/**
 * Safe context about the request that failed.
 *
 * Only the method and the URL's origin and path are kept: filters and method arguments in the
 * query string routinely carry values that should never reach a log, and neither should
 * credentials or a fragment.
 */
export interface FrappeRequestContext {
    /** HTTP method of the failed request. */
    method: string
    /** Origin and path of the failed request — never its query, fragment or credentials. */
    url: string
}

/** Everything a {@link FrappeError} can carry beyond its message. */
export interface FrappeErrorOptions {
    /** HTTP status. `0` when the request never produced a response. */
    status?: number
    /** Messages parsed out of Frappe's `_server_messages` envelope. */
    serverMessages?: readonly ServerMessage[]
    /** The server's exception class name, when it reported one. */
    exception?: string
    /** Which request failed. Its URL is reduced to origin and path, whatever the caller passes. */
    request?: FrappeRequestContext
    /** The underlying failure, such as the `TypeError` fetch throws on a network error. */
    cause?: unknown
}

/**
 * What {@link FrappeError.toJSON} returns: every field worth logging, and nothing that is not
 * safe to log.
 */
export interface FrappeErrorJSON {
    /** The error class name, such as `NotFoundError`. */
    name: string
    /** The human-readable message. */
    message: string
    /** HTTP status, or `0` when the request never produced a response. */
    status: number
    /** The server's exception class name, when it reported one. */
    exception: string | undefined
    /** Messages the server intended for a human. */
    serverMessages: readonly ServerMessage[]
    /** Which request failed: method, origin and path. */
    request: FrappeRequestContext | undefined
}

/**
 * Base class for every error this client raises.
 *
 * Every failure is a `FrappeError`, so a single `catch` can handle all of them, and
 * `instanceof FrappeError` tells them apart from bugs in application code. Each subclass is
 * narrow enough to branch on without reading status codes. A response status that no subclass
 * describes, such as `400`, is reported as a plain `FrappeError`.
 *
 * @example
 * ```ts
 * try {
 *     await frappe.doc.create('Task', { subject: 'Ship 1.0' })
 * } catch (error) {
 *     if (error instanceof ValidationError) return showMessages(error.serverMessages)
 *     if (error instanceof ConflictError) return showDuplicate()
 *     if (error instanceof RateLimitError) return retryIn(error.retryAfter)
 *     throw error
 * }
 * ```
 */
export class FrappeError extends Error {
    /** The error class name. Each subclass narrows it to its own literal. */
    override readonly name: string = 'FrappeError'
    /** HTTP status, or `0` when the request never produced a response. */
    readonly status: number
    /** Messages the server intended for a human, in the order it sent them. */
    readonly serverMessages: readonly ServerMessage[]
    /** The server's exception class name, when it reported one. */
    readonly exception: string | undefined
    /** Which request failed: method, and URL origin and path only — never query, fragment or credentials. */
    readonly request: FrappeRequestContext | undefined

    /**
     * @param message - What went wrong, for a developer.
     * @param options - Everything else the error carries.
     */
    constructor(message: string, options: FrappeErrorOptions = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause })
        this.status = options.status ?? 0
        this.serverMessages = options.serverMessages ?? []
        this.exception = options.exception
        this.request =
            options.request === undefined
                ? undefined
                : { method: options.request.method, url: originAndPath(options.request.url) }
    }

    /**
     * A loggable shape, used by `JSON.stringify`.
     *
     * `Error#message` is not enumerable, so without this a JSON logger would drop it. `cause`
     * and `stack` are left out: a cause can hold arbitrary data, and a stack is not safe to ship
     * to every log sink.
     *
     * @example
     * ```ts
     * logger.error(JSON.stringify(error)) // {"name":"NotFoundError","message":"…","status":404,…}
     * ```
     */
    toJSON(): FrappeErrorJSON {
        return {
            name: this.name,
            message: this.message,
            status: this.status,
            exception: this.exception,
            serverMessages: this.serverMessages,
            request: this.request,
        }
    }
}

/**
 * The client was given something it cannot work with — invalid options (a missing or malformed
 * URL, settings that cannot both hold) or invalid arguments to a call. Thrown before any request
 * is sent.
 */
export class ConfigurationError extends FrappeError {
    /** Always `ConfigurationError`. */
    override readonly name = 'ConfigurationError' as const
}

/**
 * The request never reached a server, or its response never arrived: DNS failure, refused
 * connection, dropped socket, or a browser CORS rejection.
 */
export class NetworkError extends FrappeError {
    /** Always `NetworkError`. */
    override readonly name = 'NetworkError' as const
}

/** The request exceeded its own time budget. */
export class TimeoutError extends FrappeError {
    /** Always `TimeoutError`. */
    override readonly name = 'TimeoutError' as const
}

/**
 * The caller's `AbortSignal` fired. Distinct from {@link TimeoutError} so that a deliberate
 * cancellation — a user navigating away — is never reported as a failure.
 */
export class CancelledError extends FrappeError {
    /** Always `CancelledError`. */
    override readonly name = 'CancelledError' as const
}

/** `401` — the request carried no valid session or token. */
export class AuthenticationError extends FrappeError {
    /** Always `AuthenticationError`. */
    override readonly name = 'AuthenticationError' as const
}

/** `403` — the user is known, but not allowed to do this. */
export class PermissionError extends FrappeError {
    /** Always `PermissionError`. */
    override readonly name = 'PermissionError' as const
}

/** `404` — no such document, method, or route. */
export class NotFoundError extends FrappeError {
    /** Always `NotFoundError`. */
    override readonly name = 'NotFoundError' as const
}

/**
 * `409` — a document with this name already exists. Frappe raises `DuplicateEntryError` (or
 * `NameError`), which {@link FrappeError.exception} carries. A duplicate value in a unique field
 * is a {@link ValidationError} (`UniqueValidationError`, `417`).
 */
export class ConflictError extends FrappeError {
    /** Always `ConflictError`. */
    override readonly name = 'ConflictError' as const
}

/**
 * The server rejected the data: a failed validation, a mandatory field, a broken link.
 * Frappe reports these as `417`, and the detail the user needs is in
 * {@link FrappeError.serverMessages}.
 */
export class ValidationError extends FrappeError {
    /** Always `ValidationError`. */
    override readonly name = 'ValidationError' as const
}

/** Everything a {@link RateLimitError} can carry beyond its message. */
export interface RateLimitErrorOptions extends FrappeErrorOptions {
    /** Milliseconds the server asked to wait before retrying, from `Retry-After`. */
    retryAfter?: number
}

/** `429` — too many requests. Frappe raises `TooManyRequestsError`. */
export class RateLimitError extends FrappeError {
    /** Always `RateLimitError`. */
    override readonly name = 'RateLimitError' as const
    /** Milliseconds the server asked to wait before retrying, when it sent `Retry-After`. */
    readonly retryAfter: number | undefined

    /**
     * @param message - What went wrong, for a developer.
     * @param options - Everything a {@link FrappeError} carries, plus `retryAfter`.
     */
    constructor(message: string, options: RateLimitErrorOptions = {}) {
        super(message, options)
        this.retryAfter = options.retryAfter
    }

    /**
     * The same loggable shape as {@link FrappeError.toJSON}, plus `retryAfter`.
     *
     * @example
     * ```ts
     * logger.warn(JSON.stringify(error)) // {"name":"RateLimitError",…,"retryAfter":1500}
     * ```
     */
    override toJSON(): FrappeErrorJSON & { retryAfter: number | undefined } {
        return { ...super.toJSON(), retryAfter: this.retryAfter }
    }
}

/** `5xx` — the server failed while handling an otherwise valid request. */
export class ServerError extends FrappeError {
    /** Always `ServerError`. */
    override readonly name = 'ServerError' as const
}

/** Drops the query, fragment and credentials from a URL, which may be relative. */
function originAndPath(url: string): string {
    if (!URL.canParse(url)) return url.replace(/[?#].*$/su, '')
    const { origin, pathname } = new URL(url)
    return origin + pathname
}
