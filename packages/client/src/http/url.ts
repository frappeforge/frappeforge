// Request URLs: the path on the site and the query string.

import { ConfigurationError } from '../errors.js'
import type { QueryValue, RawRequest } from '../types.js'

/**
 * A `.` or `..` segment, also percent-encoded. The URL parser resolves them, so the request would
 * leave the site's path prefix or reach another route. It also reads `\` as `/` and drops tabs,
 * newlines and trailing spaces, so those are rejected outright (see `buildUrl`).
 */
const dotSegment = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/iu

/**
 * Joins the site URL, a path and a query. Concatenation, not `new URL(path, base)`, which would
 * drop a path prefix in the site URL.
 */
export function buildUrl(base: string, path: string, query: RawRequest['query'] = {}): string {
    if (!/^\/[^?#\\\s\p{Cc}]*$/u.test(path) || dotSegment.test(path)) {
        throw new ConfigurationError(
            `Request path must start with "/", without "?", "#", "\\", whitespace, or "." and ".." segments (use \`query\` for parameters): ${JSON.stringify(path)}`,
        )
    }
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
        const encoded = encodeQueryValue(key, value)
        if (encoded !== undefined) params.append(key, encoded)
    }
    const search = params.toString()
    return search === '' ? base + path : `${base}${path}?${search}`
}

function encodeQueryValue(key: string, value: QueryValue): string | undefined {
    if (value === null || value === undefined) return undefined
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? '1' : '0'
    const what = `Query parameter ${JSON.stringify(key)} cannot be encoded as JSON.`
    try {
        // `undefined` for a function, a symbol, or a `toJSON` that returns nothing.
        const json = JSON.stringify(value) as string | undefined
        if (json !== undefined) return json
    } catch (cause) {
        throw new ConfigurationError(what, { cause })
    }
    throw new ConfigurationError(what)
}
