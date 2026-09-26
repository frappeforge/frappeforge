// OAuth bearer authentication, with an optional refresh shared by concurrent requests.

import { ConfigurationError } from '../errors.js'
import type { AuthStrategy } from './strategy.js'

/** Options for {@link bearerAuth}. */
export interface BearerAuthOptions {
    /**
     * The access token, or a function returning it (sync or async). A function is called before
     * every attempt, so it can return a token that changed since the last request.
     */
    token: string | (() => string | Promise<string>)
    /**
     * Obtains a new token after a `401`, for `token` to return. Resolve `true` to send the request
     * again with it. Concurrent `401`s share one call. Needs `token` to be a function.
     */
    refresh?: () => boolean | Promise<boolean>
}

/** Frappe splits the header on a space: a token is visible ASCII. */
const valid = /^[!-~]+$/u

/**
 * Authenticates every request with an OAuth access token.
 *
 * With `refresh`, a `401` calls it and, when it resolves `true`, sends the request once more. A
 * burst of requests that fail together causes one refresh, not one each; a request that was sent
 * with a token that has been replaced since is sent again without refreshing. When `token()` no
 * longer returns a usable token, the `401` stands. The timeout covers each attempt, not `token()`
 * or `refresh()`; the request's signal can cancel either.
 *
 * @param options - The token, and how to renew it.
 *
 * @example
 * ```ts
 * const frappe = createClient({
 *     url: 'https://example.com',
 *     auth: bearerAuth({
 *         token: () => session.accessToken,
 *         refresh: async () => {
 *             session.accessToken = await renewAccessToken(session.refreshToken)
 *             return true
 *         },
 *     }),
 * })
 * ```
 */
export function bearerAuth(options: BearerAuthOptions): AuthStrategy {
    const { token, refresh } = Object(options) as Partial<Record<keyof BearerAuthOptions, unknown>>
    if (typeof token !== 'function' && (typeof token !== 'string' || !valid.test(token))) {
        throw new ConfigurationError(
            'bearerAuth() needs `token` as a non-empty string of visible ASCII characters, or a function returning one.',
        )
    }
    if (refresh !== undefined && typeof refresh !== 'function') {
        throw new ConfigurationError('bearerAuth(): `refresh` must be a function.')
    }
    if (refresh !== undefined && typeof token === 'string') {
        throw new ConfigurationError(
            'bearerAuth(): `refresh` needs `token` to be a function, because a fixed string cannot change after a refresh.',
        )
    }

    const read = async (): Promise<string> => {
        const value: unknown = typeof token === 'string' ? token : await (token as () => unknown)()
        if (typeof value !== 'string' || !valid.test(value)) {
            throw new ConfigurationError(
                'The bearer token function must return a non-empty string of visible ASCII characters.',
            )
        }
        return `Bearer ${value}`
    }
    const apply = async (headers: Headers): Promise<void> => {
        headers.set('Authorization', await read())
    }
    if (refresh === undefined) return Object.freeze({ apply })

    // The refresh in flight, shared by every 401 that arrives meanwhile; how many have settled; and
    // whether the last one renewed the token.
    let refreshing: Promise<boolean> | undefined
    let settled = 0
    let renewed = false
    const start = (): Promise<boolean> => {
        refreshing = Promise.resolve()
            .then(refresh as () => unknown)
            .then(
                (result) => {
                    renewed = result === true
                    return renewed
                },
                (error: unknown) => {
                    renewed = false
                    throw error
                },
            )
            .finally(() => {
                refreshing = undefined
                settled += 1
            })
        return refreshing
    }
    return Object.freeze({
        apply,
        async onUnauthorized(request: Request): Promise<boolean> {
            const before = settled
            // No usable token now (the app signed out, say): nothing to send again, so the 401 stands.
            const current = await read().catch(() => undefined)
            // A refresh is running, or one settled while the token was read, which may predate it.
            if (refreshing !== undefined) return refreshing
            if (settled !== before) return renewed
            if (current === undefined) return false
            // Sent with a token that has been replaced since: send it again with the current one.
            if (request.headers.get('Authorization') !== current) return true
            return start()
        },
    })
}
