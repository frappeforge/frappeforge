// Client options: validated once, before any request, and frozen.

import { ConfigurationError } from './errors.js'
import { assertTimeout, type ResolvedConfig } from './http/send.js'

/** Options for {@link createClient}. */
export interface ClientOptions {
    /** Site URL, e.g. `https://example.com`. A path prefix is allowed; query, fragment and credentials are not. */
    url: string
    /** Headers sent with every request. */
    headers?: Record<string, string>
    /** Per-request time budget in milliseconds. Default `30_000`; `0` disables the timeout. */
    timeout?: number
    /**
     * Sends `X-Frappe-Site-Name`. Only for sites reached through a host that differs from the site
     * name. Visible ASCII, e.g. `site1.local`. A custom header makes browsers send a CORS preflight.
     */
    siteName?: string
    /**
     * A fetch-compatible function, for instrumentation, tests or custom agents. Default: the global
     * `fetch`. It must honor `request.signal`: timeouts and cancellation abort through it.
     */
    fetch?: (request: Request) => Promise<Response>
}

const DEFAULT_TIMEOUT = 30_000

/** Validates the options and fills in defaults. Throws `ConfigurationError` on the first invalid option. */
export function resolveConfig(options: ClientOptions): ResolvedConfig {
    if (!isPlainObject(options)) throw new ConfigurationError('createClient() needs an options object with a `url`.')
    const { url, headers = {}, timeout = DEFAULT_TIMEOUT, siteName, fetch } = options
    // Visible ASCII: a site or host name, and always a valid header value.
    if (siteName !== undefined && (typeof siteName !== 'string' || !/^[!-~]+$/u.test(siteName))) {
        throw new ConfigurationError(
            '`siteName` must be a non-empty string of visible ASCII characters, e.g. "site1.local".',
        )
    }
    if (fetch !== undefined && typeof fetch !== 'function') {
        throw new ConfigurationError('`fetch` must be a function that takes a Request and returns a Response.')
    }
    return Object.freeze({
        url: normalizeUrl(url),
        headers: resolveHeaders(headers),
        timeout: assertTimeout(timeout, '`timeout`'),
        siteName,
        fetch,
    })
}

/** `origin + path`, without trailing slashes. */
function normalizeUrl(url: unknown): string {
    const parsed = typeof url === 'string' && URL.canParse(url) ? new URL(url) : undefined
    if (
        parsed === undefined ||
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.search !== '' ||
        parsed.hash !== ''
    ) {
        throw new ConfigurationError(
            `\`url\` must be an http(s) URL without credentials, query or fragment, e.g. "https://example.com".`,
        )
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/u, '')
}

function resolveHeaders(headers: unknown): Readonly<Record<string, string>> {
    if (!isPlainObject(headers) || Object.values(headers).some((value) => typeof value !== 'string')) {
        throw new ConfigurationError('`headers` must be a plain object of string values.')
    }
    const copy = { ...(headers as Record<string, string>) }
    try {
        new Headers(copy)
    } catch (cause) {
        throw new ConfigurationError('`headers` contains an invalid header name or value.', { cause })
    }
    return Object.freeze(copy)
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null) return false
    const prototype: unknown = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}
