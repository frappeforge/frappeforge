// `frappe.call`: call whitelisted server methods.

import { InvalidArgumentError } from '../errors.js'
import { isAny, isPlainObject, readMember } from '../http/decode.js'
import type { Send } from '../http/send.js'
import type { QueryValue, RequestOptions } from '../types.js'

/**
 * `frappe.call`: call a whitelisted server method, by GET or by POST. Function properties, so
 * they can be destructured.
 *
 * The result is the method's return value, Frappe's `message`; a method that returns nothing
 * resolves `undefined`. `T` describes the value you expect; it is not checked at runtime.
 *
 * Every method rejects with a `FrappeError` subclass: the status errors with the server's
 * messages, `TimeoutError`, `AbortError`, `NetworkError`, or `InvalidArgumentError` — before any
 * request — for an invalid argument.
 */
export interface CallNamespace {
    /**
     * Calls a whitelisted method with `GET`. The arguments go in the query string: strings as
     * they are, numbers via `String`, booleans as `1` / `0`, arrays and objects as JSON, so the
     * method receives them as strings. A `GET` needs no CSRF token.
     *
     * @param method - The method's dotted path, such as `'frappe.ping'`, or a Server Script's API
     * method name.
     * @param args - The method's arguments.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const pong = await frappe.call.get<string>('frappe.ping')
     * ```
     */
    readonly get: <T = unknown>(
        method: string,
        args?: Readonly<Record<string, QueryValue>>,
        options?: RequestOptions,
    ) => Promise<T>
    /**
     * Calls a whitelisted method with `POST`. The arguments are sent as JSON, so the method
     * receives numbers, booleans, lists and objects as they are.
     *
     * @param method - The method's dotted path, such as `'my_app.api.recalculate'`, or a Server
     * Script's API method name.
     * @param args - The method's arguments.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const total = await frappe.call.post<number>('my_app.api.recalculate', { name: 'SO-0001' })
     * ```
     */
    readonly post: <T = unknown>(
        method: string,
        args?: Readonly<Record<string, unknown>>,
        options?: RequestOptions,
    ) => Promise<T>
}

/**
 * What the runtime object must be: exactly the methods of `CallNamespace`. Their arguments are
 * `unknown`, checked at runtime for callers without types.
 */
type CallMethods = { readonly [K in keyof CallNamespace]: (...args: never[]) => unknown }

/** Frappe leaves `message` out when a method returns `None`. */
const readMessage = readMember('message', isAny, 'a value')

/** Creates `frappe.call` over the client's pipeline. */
export function createCallNamespace(send: Send): CallNamespace {
    const namespace = {
        get: async (method: unknown, args: unknown = {}, options: RequestOptions = {}) =>
            // A value the query string cannot hold is an `InvalidArgumentError` from `buildUrl`.
            send(
                { path: methodPath(method), query: assertArgs(args) as Readonly<Record<string, QueryValue>> },
                options,
                readMessage,
            ),
        post: async (method: unknown, args?: unknown, options: RequestOptions = {}) => {
            const path = methodPath(method)
            // Without arguments, no body: Frappe reads an empty request as no arguments.
            const body = args === undefined ? {} : { body: assertArgs(args) }
            return send({ method: 'POST', path, ...body }, options, readMessage)
        },
    } satisfies CallMethods
    return Object.freeze(namespace) as unknown as CallNamespace
}

/**
 * The path of a whitelisted method. Any name without `/` is accepted, since a Server Script's API
 * method name is free text; Frappe ignores everything after a `/`, which would call another
 * method. The name is encoded for the URL.
 */
function methodPath(method: unknown): string {
    if (typeof method !== 'string' || method === '' || method.includes('/')) {
        throw new InvalidArgumentError('`method` must be a non-empty string without "/", such as "frappe.ping".')
    }
    return `/api/method/${encodeURIComponent(method)}`
}

/** The arguments: a plain object. Anything else, such as `FormData`, would change the request. */
function assertArgs(args: unknown): Readonly<Record<string, unknown>> {
    if (isPlainObject(args)) return args
    throw new InvalidArgumentError('`args` must be a plain object of arguments.')
}
