// `Set-Cookie` parsing and `Cookie` serialization for a client that talks to one site.
//
// Only the name, the value and whether the cookie is already expired matter: `Domain` and `Path`
// are ignored (one site, and Frappe sets every cookie on `/`), and so are `Secure`, `HttpOnly`,
// `SameSite` and any other attribute. Values are kept exactly as received, quotes and
// percent-encoding included, because they are only ever sent back.

/** One `Set-Cookie` header, reduced to what the jar needs. */
export interface SetCookie {
    readonly name: string
    readonly value: string
    /** `Max-Age` is `0` or less, or `Expires` is not in the future: the server deletes the cookie. */
    readonly expired: boolean
}

/**
 * Parses one `Set-Cookie` header value. `undefined` when it holds no cookie: no `=` in the
 * name-value pair, or an empty name (RFC 6265, section 5.2).
 *
 * `Max-Age` wins over `Expires` wherever it appears, and the last occurrence of an attribute
 * counts (section 5.3). `Max-Age` must be an optional `-` and digits. `Expires` is read only as an
 * HTTP date — a day name first and `GMT` last — because `Date.parse` alone reads `0` as the year
 * 2000 and an asctime date as local time; any other value is ignored, as browsers do.
 */
export function parseSetCookie(header: string, now: number): SetCookie | undefined {
    const [pair = '', ...attributes] = header.split(';')
    const separator = pair.indexOf('=')
    if (separator < 0) return undefined
    const name = trim(pair.slice(0, separator))
    if (name === '') return undefined
    const value = trim(pair.slice(separator + 1))

    let maxAge: number | undefined
    let expires: number | undefined
    for (const attribute of attributes) {
        const equals = attribute.indexOf('=')
        const key = trim(equals < 0 ? attribute : attribute.slice(0, equals)).toLowerCase()
        const text = equals < 0 ? '' : trim(attribute.slice(equals + 1))
        if (key === 'max-age' && /^-?\d+$/u.test(text)) maxAge = Number(text)
        if (key === 'expires' && /^[a-z]{3,9}, .+ GMT$/iu.test(text)) {
            const date = Date.parse(text)
            if (!Number.isNaN(date)) expires = date
        }
    }
    const expired = maxAge === undefined ? expires !== undefined && expires <= now : maxAge <= 0
    return { name, value, expired }
}

/** The `Cookie` header for a jar: `a=1; b=2` in insertion order, or `''` when it is empty. */
export function serializeCookies(jar: ReadonlyMap<string, string>): string {
    return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ')
}

/** Removes the whitespace RFC 6265 allows around names, values and attributes: spaces and tabs. */
function trim(text: string): string {
    return text.replace(/^[ \t]+|[ \t]+$/gu, '')
}
