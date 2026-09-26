// `Headers` whose errors never quote a value: the runtime's own message does, and a value can be a
// token or a password.

/** An HTTP token (RFC 9110, section 5.6.2): what a header name must be. */
const headerName = /^[!#$%&'*+.^`|~\w-]+$/u

/**
 * `Headers` whose `set` and `append` reject an invalid name or value with a `TypeError` that names
 * the header but never quotes the value, so that the error can be logged. The pipeline builds every
 * request's headers with it, and hands it to the strategy's `apply`.
 */
export class SafeHeaders extends Headers {
    override set(name: string, value: string): void {
        try {
            super.set(name, value)
        } catch {
            throw invalidHeader(name)
        }
    }

    override append(name: string, value: string): void {
        try {
            super.append(name, value)
        } catch {
            throw invalidHeader(name)
        }
    }
}

/** An invalid name is not quoted either: a value passed as a name by mistake would be. */
function invalidHeader(name: string): TypeError {
    return new TypeError(
        headerName.test(name) ? `The "${name}" header has an invalid value.` : 'A header has an invalid name.',
    )
}
