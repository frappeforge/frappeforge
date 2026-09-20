/**
 * The error taxonomy.
 *
 * Every failure this client raises is a {@link FrappeError}, so a single `catch` can handle
 * all of them, and each subclass is narrow enough to branch on without reading status codes.
 *
 * @example
 * ```ts
 * try {
 *     await frappe.doc.get('Task', 'TASK-0001')
 * } catch (error) {
 *     if (error instanceof NotFoundError) return null
 *     if (error instanceof PermissionError) return redirectToLogin()
 *     throw error
 * }
 * ```
 */

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
 * The URL has its query string removed, because filters and method arguments routinely carry
 * values that should never reach a log.
 */
export interface FrappeRequestContext {
    /** HTTP method of the failed request. */
    method: string
    /** Absolute URL of the failed request, with the query string removed. */
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
    /** Which request failed. */
    request?: FrappeRequestContext
    /** The underlying failure, such as the `TypeError` fetch throws on a network error. */
    cause?: unknown
}

/**
 * Base class for every error this client raises.
 *
 * `error instanceof FrappeError` is always true for failures that originate here, which makes
 * it easy to tell them apart from bugs in application code.
 */
export class FrappeError extends Error {
    /** HTTP status, or `0` when the request never produced a response. */
    readonly status: number
    /** Messages the server intended for a human, in the order it sent them. */
    readonly serverMessages: readonly ServerMessage[]
    /** The server's exception class name, when it reported one. */
    readonly exception: string | undefined
    /** Which request failed. Never includes a query string. */
    readonly request: FrappeRequestContext | undefined

    constructor(message: string, options: FrappeErrorOptions = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause })
        this.name = 'FrappeError'
        this.status = options.status ?? 0
        this.serverMessages = options.serverMessages ?? []
        this.exception = options.exception
        this.request = options.request
    }
}

/**
 * The client was given options it cannot work with — a missing URL, a malformed one, or a
 * combination of settings that cannot both hold. Thrown before any request is sent.
 */
export class ConfigurationError extends FrappeError {
    constructor(message: string, options?: FrappeErrorOptions) {
        super(message, options)
        this.name = 'ConfigurationError'
    }
}

/**
 * The request never reached a server, or its response never arrived: DNS failure, refused
 * connection, dropped socket, or a browser CORS rejection.
 */
export class NetworkError extends FrappeError {
    constructor(message: string, options?: FrappeErrorOptions) {
        super(message, options)
        this.name = 'NetworkError'
    }
}

/** The request exceeded its own time budget. */
export class TimeoutError extends FrappeError {
    constructor(message: string, options?: FrappeErrorOptions) {
        super(message, options)
        this.name = 'TimeoutError'
    }
}

/**
 * The caller's `AbortSignal` fired. Distinct from {@link TimeoutError} so that a deliberate
 * cancellation — a user navigating away — is never reported as a failure.
 */
export class CancelledError extends FrappeError {
    constructor(message: string, options?: FrappeErrorOptions) {
        super(message, options)
        this.name = 'CancelledError'
    }
}

/** `401` — the request carried no valid session or token. */
export class AuthenticationError extends FrappeError {
    constructor(message: string, options?: FrappeErrorOptions) {
        super(message, options)
        this.name = 'AuthenticationError'
    }
}

/** `403` — the user is known, but not allowed to do this. */
export class PermissionError extends FrappeError {
    constructor(message: string, options?: FrappeErrorOptions) {
        super(message, options)
        this.name = 'PermissionError'
    }
}

/** `404` — no such document, method, or route. */
export class NotFoundError extends FrappeError {
    constructor(message: string, options?: FrappeErrorOptions) {
        super(message, options)
        this.name = 'NotFoundError'
    }
}

/**
 * The server rejected the data: a failed validation, a mandatory field, a broken link.
 * Frappe reports these as `417`, and the detail the user needs is in
 * {@link FrappeError.serverMessages}.
 */
export class ValidationError extends FrappeError {
    constructor(message: string, options?: FrappeErrorOptions) {
        super(message, options)
        this.name = 'ValidationError'
    }
}

/** `5xx` — the server failed while handling an otherwise valid request. */
export class ServerError extends FrappeError {
    constructor(message: string, options?: FrappeErrorOptions) {
        super(message, options)
        this.name = 'ServerError'
    }
}
