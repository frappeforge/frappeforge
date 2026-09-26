// API key authentication: `Authorization: token <key>:<secret>`.

import { ConfigurationError } from '../errors.js'
import type { AuthStrategy } from './strategy.js'

/** Options for {@link tokenAuth}. */
export interface TokenAuthOptions {
    /** The API key from **User → Settings → API Access**. */
    apiKey: string
    /** The API secret generated with it. */
    apiSecret: string
}

/**
 * Frappe splits the header on a space and the pair on `:`, and ignores credentials that do not
 * give exactly two parts: visible ASCII without `:`.
 */
const credential = /^[!-9;-~]+$/u

/**
 * Authenticates every request with an API key and secret. Keep them on a server: never ship them
 * to a browser.
 *
 * The header is built once and held in a closure, so neither `JSON.stringify` nor `inspect` of the
 * strategy or the client can reveal it.
 *
 * @param options - The key and the secret, each visible ASCII without `:`.
 *
 * @example
 * ```ts
 * const frappe = createClient({
 *     url: 'https://example.com',
 *     auth: tokenAuth({ apiKey: process.env.FRAPPE_API_KEY!, apiSecret: process.env.FRAPPE_API_SECRET! }),
 * })
 * ```
 */
export function tokenAuth(options: TokenAuthOptions): AuthStrategy {
    const { apiKey, apiSecret } = Object(options) as Partial<Record<keyof TokenAuthOptions, unknown>>
    if (typeof apiKey !== 'string' || !credential.test(apiKey)) throw invalid('apiKey')
    if (typeof apiSecret !== 'string' || !credential.test(apiSecret)) throw invalid('apiSecret')
    const authorization = `token ${apiKey}:${apiSecret}`
    return Object.freeze({
        apply(headers: Headers): void {
            headers.set('Authorization', authorization)
        },
    })
}

function invalid(name: keyof TokenAuthOptions): ConfigurationError {
    return new ConfigurationError(
        `tokenAuth() needs \`${name}\` as a non-empty string of visible ASCII characters without ":".`,
    )
}
