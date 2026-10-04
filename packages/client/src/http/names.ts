// Document names and DocType names: checked before they reach a path or a request body.

import { InvalidArgumentError } from '../errors.js'

/**
 * A DocType name: a non-empty string. It goes into the path through `encodeURIComponent`, so `/`,
 * `#`, `?` and `%` are safe.
 */
export function assertDoctype(value: unknown): string {
    if (typeof value !== 'string' || value === '') {
        throw new InvalidArgumentError('`doctype` must be a non-empty string.')
    }
    return value
}

/**
 * A document name, as the string Frappe compares: a non-empty string, or a positive safe integer
 * for DocTypes named by "Autoincrement". A number is sent as its decimal string, which an integer
 * `name` column compares as a number and a text column as text.
 */
export function assertDocName(value: unknown, label = '`name`'): string {
    if (typeof value === 'string' && value !== '') return value
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
    throw new InvalidArgumentError(`${label} must be a non-empty string or a positive integer.`)
}
