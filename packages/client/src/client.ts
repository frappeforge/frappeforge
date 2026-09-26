// `createClient`: resolves the options once and returns the frozen client.

import { type ClientOptions, resolveConfig } from './config.js'
import { readJson } from './http/decode.js'
import { type Send, send as sendRequest } from './http/send.js'
import { type AuthNamespace, createAuthNamespace } from './resources/auth.js'
import type { RawRequest, RequestOptions } from './types.js'

/** A client for one Frappe site. Create it with {@link createClient}. */
export interface FrappeClient {
    /** The normalized site URL, without a trailing slash. */
    readonly url: string
    /** The configured site name, if any. */
    readonly siteName: string | undefined
    /**
     * Sends any request through the client's pipeline and returns the decoded JSON body, or
     * `undefined` for an empty one. `T` describes the body you expect; it is not checked at
     * runtime.
     *
     * Rejects with a `FrappeError` subclass: the status errors for non-2xx responses (with the
     * server's messages), `TimeoutError`, `CancelledError`, `NetworkError`, or
     * `ConfigurationError` for a request that cannot be built.
     *
     * A function property, not a method: it never uses `this`, so `const { request } = frappe` is
     * safe, and lint rules such as `unbound-method` know it.
     *
     * @param init - Method, path, query and body.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const { message } = await frappe.request<{ message: string }>({ path: '/api/method/frappe.ping' })
     * ```
     */
    readonly request: <T = unknown>(init: RawRequest, options?: RequestOptions) => Promise<T>
    /** Sign in, sign out, and who is signed in. */
    readonly auth: AuthNamespace
}

/**
 * Creates a client for one Frappe site. Options are validated here, so a mistake throws a
 * `ConfigurationError` before any request is sent.
 *
 * @example
 * ```ts
 * const frappe = createClient({ url: 'https://example.com' })
 * const todo = await frappe.request({ path: '/api/resource/ToDo/TODO-0001' })
 * ```
 */
export function createClient(options: ClientOptions): FrappeClient {
    const config = resolveConfig(options)
    const send: Send = (init, requestOptions, read) => sendRequest(config, init, requestOptions, read)
    return Object.freeze({
        url: config.url,
        siteName: config.siteName,
        request: <T = unknown>(init: RawRequest, requestOptions: RequestOptions = {}): Promise<T> =>
            send(init, requestOptions, readJson) as Promise<T>,
        auth: createAuthNamespace(send, () => {
            config.auth?.clear?.()
        }),
    })
}
