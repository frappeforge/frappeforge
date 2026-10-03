// `createClient`: resolves the options once and returns the frozen client.

import { type ClientOptions, resolveConfig } from './config.js'
import { readJson } from './http/decode.js'
import { type Send, send as sendRequest } from './http/send.js'
import { type AuthNamespace, createAuthNamespace } from './namespaces/auth.js'
import { type CallNamespace, createCallNamespace } from './namespaces/call.js'
import { createDocNamespace, type DocNamespace } from './namespaces/doc.js'
import { createFileNamespace, type FileNamespace } from './namespaces/file.js'
import type { FrappeRequest, RegisteredDocTypes, RequestOptions } from './types.js'

/**
 * A client for one Frappe site. Create it with {@link createClient}.
 *
 * `D` is the DocType map that types `doc`: by default the one `@frappeforge/codegen` registers
 * (see `Register`), else none, and every DocType is accepted with `unknown` values.
 */
export interface FrappeClient<D extends object = RegisteredDocTypes> {
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
     * server's messages), `TimeoutError`, `AbortError`, `NetworkError`, or
     * `InvalidArgumentError` for a request that cannot be built.
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
    readonly request: <T = unknown>(init: FrappeRequest, options?: RequestOptions) => Promise<T>
    /** Sign in, sign out, and who is signed in. */
    readonly auth: AuthNamespace
    /** Read and write documents, and run their whitelisted methods. */
    readonly doc: DocNamespace<D>
    /** Call whitelisted server methods. */
    readonly call: CallNamespace
    /** Upload and download files. */
    readonly file: FileNamespace
}

/**
 * Creates a client for one Frappe site. Options are validated here, so a mistake throws a
 * `InvalidArgumentError` before any request is sent.
 *
 * Documents are typed by the DocTypes `@frappeforge/codegen` registers. Pass a DocType map as
 * `D` to use another one.
 *
 * @example
 * ```ts
 * const frappe = createClient({ url: 'https://example.com' })
 * const todo = await frappe.doc.get('ToDo', 'TODO-0001')
 * ```
 */
export function createClient<D extends object = RegisteredDocTypes>(options: ClientOptions): FrappeClient<D> {
    const config = resolveConfig(options)
    const send: Send = (init, requestOptions, read) => sendRequest(config, init, requestOptions, read)
    return Object.freeze({
        url: config.url,
        siteName: config.siteName,
        request: <T = unknown>(init: FrappeRequest, requestOptions: RequestOptions = {}): Promise<T> =>
            send(init, requestOptions, readJson) as Promise<T>,
        auth: createAuthNamespace(send, () => {
            config.auth?.clear?.()
        }),
        doc: createDocNamespace<D>(send),
        call: createCallNamespace(send),
        file: createFileNamespace(send),
    } satisfies FrappeClient<D>)
}
