// `frappe.auth`: sign in, sign out, and who is signed in.

import { AuthenticationError, ConfigurationError, type FrappeRequestContext, PermissionError } from '../errors.js'
import { isRecord, readJson, readMember } from '../http/decode.js'
import type { Send } from '../http/send.js'
import type { RequestOptions } from '../types.js'

/** What {@link AuthNamespace.login} resolves with. */
export interface LoginResult {
    /** The user's display name, as Frappe returns it. */
    fullName: string
    /**
     * Where Frappe would send this user next, exactly as Frappe returns it. For a System User,
     * Frappe 15 answers `/app` or `/app/<workspace>`, and Frappe 16 the site's home page, such as
     * `desk`, which has no leading `/`.
     */
    homePage: string
}

/**
 * `frappe.auth`: sign in, sign out, and who is signed in. Function properties, so they can be
 * destructured.
 */
export interface AuthNamespace {
    /**
     * Signs in with a username (or email) and password, creating a session. Use it with
     * {@link sessionAuth}; a client with {@link tokenAuth} is already signed in.
     *
     * Rejects with `AuthenticationError` for wrong credentials, and also when Frappe asks for a
     * second factor or for a new password: the sign-in did not complete, so there is no session.
     * In a page served by Frappe, reload after signing in, so that the page's CSRF token belongs to
     * the new session — as Frappe's own login page does.
     *
     * @param credentials - The username or email, and the password.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const { fullName, homePage } = await frappe.auth.login({ username: 'jane@example.com', password })
     * ```
     */
    readonly login: (
        credentials: { username: string; password: string },
        options?: RequestOptions,
    ) => Promise<LoginResult>
    /**
     * Ends the session. The strategy's stored credentials are cleared even when the request fails,
     * and the failure is rethrown. Signing out when already signed out succeeds.
     *
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * await frappe.auth.logout()
     * ```
     */
    readonly logout: (options?: RequestOptions) => Promise<void>
    /**
     * The signed-in user's id, or `null` for Guest. An expired session runs as Guest, so this is
     * how to tell "signed out" from "not allowed" after a `PermissionError`.
     *
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * if ((await frappe.auth.currentUser()) === null) redirectToLogin()
     * ```
     */
    readonly currentUser: (options?: RequestOptions) => Promise<string | null>
}

/** Creates `frappe.auth` over the client's pipeline; `clear` forgets the strategy's credentials. */
export function createAuthNamespace(send: Send, clear: () => void): AuthNamespace {
    return Object.freeze({
        login: async (
            credentials: { username: string; password: string },
            options: RequestOptions = {},
        ): Promise<LoginResult> => {
            const { username, password } = Object(credentials) as Partial<Record<'username' | 'password', unknown>>
            if (typeof username !== 'string' || username === '' || typeof password !== 'string' || password === '') {
                throw new ConfigurationError('login() needs a `username` and a `password`, both non-empty strings.')
            }
            return send(
                { method: 'POST', path: '/api/method/login', body: { usr: username, pwd: password } },
                options,
                readLogin,
            )
        },
        logout: async (options: RequestOptions = {}): Promise<void> => {
            try {
                await send({ method: 'POST', path: '/api/method/logout' }, options, readJson)
            } finally {
                clear()
            }
        },
        currentUser: async (options: RequestOptions = {}): Promise<string | null> => {
            try {
                const user = await send(
                    { path: '/api/method/frappe.auth.get_logged_user' },
                    options,
                    readMember('message', isString, 'a string'),
                )
                return user === 'Guest' ? null : user
            } catch (error) {
                // Guest gets 403 here, and a rejected token 401.
                if (error instanceof AuthenticationError || error instanceof PermissionError) return null
                throw error
            }
        },
    })
}

/**
 * A completed sign-in has `full_name` and `home_page`. Frappe answers `200` without a session when
 * it asks for a second factor (`tmp_id`) or for a new password (`Password Reset`).
 */
async function readLogin(response: Response, context: FrappeRequestContext): Promise<LoginResult> {
    const body = await readJson(response, context)
    const record = isRecord(body) ? body : {}
    const { full_name: fullName, home_page: homePage } = record
    if (typeof fullName === 'string' && typeof homePage === 'string') return { fullName, homePage }
    const message =
        'tmp_id' in record
            ? 'Two-factor authentication is not supported yet.'
            : record['message'] === 'Password Reset'
              ? 'The password has expired and must be reset before signing in.'
              : 'The server did not complete the sign-in.'
    throw new AuthenticationError(message, { status: response.status, request: context })
}

function isString(value: unknown): value is string {
    return typeof value === 'string'
}
