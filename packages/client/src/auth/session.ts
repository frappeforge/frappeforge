// Session (cookie) authentication, with CSRF handling. The same code runs in browsers and Node.

import { ConfigurationError } from '../errors.js'
import { parseSetCookie, serializeCookies } from './cookies.js'
import type { AuthStrategy } from './strategy.js'

/** Options for {@link sessionAuth}. */
export interface SessionAuthOptions {
    /**
     * The CSRF token, or a function returning it (read on every `POST`, `PUT`, `PATCH` and
     * `DELETE`). Default: the page's `csrf_token` global, which Frappe sets on the pages it renders.
     */
    csrfToken?: string | (() => string | undefined)
}

/** The methods Frappe checks the CSRF token for. */
const unsafe: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Authenticates with the site's session cookie, created by `frappe.auth.login()` or by Frappe's own
 * login page.
 *
 * - **Browsers** keep the cookie: requests are sent with `credentials: 'include'`. The session's
 *   CSRF token comes from the page's `csrf_token` global, or from `csrfToken`.
 * - **Node** has no cookie store, so the strategy keeps the cookies it receives in a jar of its own
 *   and sends them back. A session created through the API has no CSRF token, and needs none.
 *
 * Browsers never expose `Set-Cookie` to scripts, so there the jar stays empty; nothing depends on
 * detecting the environment. The jar ignores `Domain` and `Path`: a client talks to one site.
 *
 * An expired session is not a `401`: requests run as Guest, and protected ones answer `403`. Use
 * `frappe.auth.currentUser()`, which is `null` for Guest, to tell the two apart.
 *
 * @param options - Where the CSRF token comes from.
 *
 * @example
 * ```ts
 * const frappe = createClient({ url: 'https://example.com', auth: sessionAuth() })
 * await frappe.auth.login({ username: 'jane@example.com', password })
 * ```
 */
export function sessionAuth(options: SessionAuthOptions = {}): AuthStrategy {
    const { csrfToken } = Object(options) as Partial<Record<keyof SessionAuthOptions, unknown>>
    if (csrfToken !== undefined && typeof csrfToken !== 'function' && usable(csrfToken) === undefined) {
        throw new ConfigurationError(
            'sessionAuth(): `csrfToken` must be a non-empty string of visible ASCII characters that is not an unrendered `{{ csrf_token }}` placeholder, or a function.',
        )
    }
    const csrf = (): string | undefined =>
        usable(
            typeof csrfToken === 'function'
                ? (csrfToken as () => unknown)()
                : (csrfToken ?? (globalThis as { csrf_token?: unknown }).csrf_token),
        )

    const jar = new Map<string, string>()
    return Object.freeze({
        credentials: 'include',
        apply(headers: Headers, method: string): void {
            const token = unsafe.has(method) ? csrf() : undefined
            if (token !== undefined) headers.set('X-Frappe-CSRF-Token', token)
            const cookie = serializeCookies(jar)
            if (cookie !== '') headers.set('Cookie', cookie)
        },
        onResponse(response: Response): void {
            const now = Date.now()
            // Some fetch polyfills implement Headers without getSetCookie: like a browser's, such a
            // response has no cookies to read.
            const lines = (response.headers as Partial<Pick<Headers, 'getSetCookie'>>).getSetCookie?.() ?? []
            for (const header of lines) {
                const cookie = parseSetCookie(header, now)
                if (cookie === undefined) continue
                if (cookie.expired) jar.delete(cookie.name)
                else jar.set(cookie.name, cookie.value)
            }
        },
        clear(): void {
            jar.clear()
        },
    } as const)
}

/**
 * The token, when it can be sent: a non-empty string of visible ASCII that is not an unrendered
 * template placeholder such as `{{ csrf_token }}`.
 */
function usable(value: unknown): string | undefined {
    return typeof value === 'string' && /^[!-~]+$/u.test(value) && !value.startsWith('{{') ? value : undefined
}
