// The contract between a client and the way it authenticates. Types only.

/**
 * How a client authenticates. {@link tokenAuth}, {@link sessionAuth} and {@link bearerAuth}
 * implement it; implement it yourself for a scheme FrappeForge does not ship.
 *
 * The client calls every hook as a method of the strategy, so a class works as well as an object
 * literal. What a hook throws reaches the caller unchanged. The request's signal cancels a pending
 * `apply` or `onUnauthorized` at once: the client stops waiting and ignores its result. Keep
 * credentials in a closure or a private field, never on a property, so that logging the strategy or
 * the client cannot reveal them.
 *
 * @example
 * ```ts
 * const vaultAuth: AuthStrategy = {
 *     async apply(headers) {
 *         const { key, secret } = await vault.read('frappe')
 *         headers.set('Authorization', `token ${key}:${secret}`)
 *     },
 * }
 * const frappe = createClient({ url: 'https://example.com', auth: vaultAuth })
 * ```
 */
export interface AuthStrategy {
    /**
     * Adds credentials to an outgoing request. Called before every attempt that is not already
     * cancelled, after the client's and the request's own headers are set, so what it sets wins. The
     * attempt's time budget starts after it returns.
     *
     * @param headers - The request's headers, to modify in place. An invalid name or value makes
     *   `set` and `append` throw a `TypeError` that names the header without quoting the value.
     * @param method - The request's HTTP method, upper-case, such as `GET` or `POST`.
     */
    apply(headers: Headers, method: string): void | Promise<void>
    /** The `credentials` mode for `fetch`. Default: the runtime's own, `same-origin`. */
    readonly credentials?: 'include' | 'omit' | 'same-origin'
    /**
     * Sees every response as soon as its headers arrive, before its body is read. Should not throw:
     * what it throws reaches the caller unchanged, in place of the response.
     *
     * @param response - The response, with its body unread.
     */
    onResponse?(response: Response): void
    /**
     * Called when a response is `401`. Resolve `true` to send the request once more, with the
     * headers `apply` sets then; it is never called for that second response.
     *
     * @param request - The request that received the `401`.
     */
    onUnauthorized?(request: Request): boolean | Promise<boolean>
    /** Forgets any stored credentials. Called by `auth.logout()`. */
    clear?(): void
}
