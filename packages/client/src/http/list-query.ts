// List queries: listing arguments turned into the parameters of Frappe's `get_list` and
// `get_count`, and the rule for when they no longer fit in a URL.

import { ConfigurationError } from '../errors.js'
import type { QueryValue } from '../types.js'
import { buildUrl } from './url.js'

/**
 * Listing arguments as the runtime receives them: typed callers pass `ListArgs`, untyped ones
 * anything, so every value is checked here.
 */
export interface LooseListArgs {
    readonly fields?: unknown
    readonly filters?: unknown
    readonly orFilters?: unknown
    readonly orderBy?: unknown
    readonly groupBy?: unknown
    readonly limit?: unknown
    readonly offset?: unknown
    readonly parent?: unknown
    /** `paginate` only. */
    readonly pageSize?: unknown
}

/**
 * The parameters of `get_list`, as plain values. The same object is sent as the query string
 * (where `buildUrl` writes arrays as JSON) or as a JSON body: Frappe reads both forms alike.
 */
export interface ListParams {
    readonly fields?: readonly unknown[]
    readonly filters?: readonly unknown[]
    readonly or_filters?: readonly unknown[]
    readonly order_by?: string
    readonly group_by?: string
    readonly limit_start: number
    readonly limit_page_length: number
    readonly parent?: string
}

/**
 * The longest path and query sent as a GET, in characters (the URL is ASCII, so also bytes). The
 * site URL is not counted.
 * gunicorn's default `limit_request_line` is 4094 bytes for `GET <path?query> HTTP/1.1`; this
 * leaves room for the method, the protocol and a path prefix in the site URL.
 */
export const MAX_GET_LENGTH = 3800

const DEFAULT_LIMIT = 20

/** A column name, as Frappe stores it. */
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/u

/**
 * Filters in the tuple form Frappe takes. The object form becomes one tuple per field: a value
 * means `=`, and `[operator, value]` an operator; a field whose value is `undefined` is left
 * out. Tuples pass through. Booleans become `1` / `0` at any depth.
 */
export function normalizeFilters(filters: unknown, what = '`filters`'): unknown[][] {
    if (filters === undefined) return []
    if (Array.isArray(filters)) {
        return filters.map((filter: unknown) => {
            if (!Array.isArray(filter)) {
                throw new ConfigurationError(
                    `${what} must be an object or an array of arrays such as ["status", "=", "Open"].`,
                )
            }
            return filter.map(toWire)
        })
    }
    if (typeof filters !== 'object' || filters === null) {
        throw new ConfigurationError(`${what} must be an object or an array of arrays such as ["status", "=", "Open"].`)
    }
    const tuples: unknown[][] = []
    for (const [field, value] of Object.entries(filters)) {
        if (value === undefined) continue
        tuples.push(Array.isArray(value) ? [field, ...value.map(toWire)] : [field, '=', toWire(value)])
    }
    return tuples
}

/** Frappe compares Check fields with `1` / `0`. */
function toWire(value: unknown): unknown {
    if (typeof value === 'boolean') return value ? 1 : 0
    return Array.isArray(value) ? value.map(toWire) : value
}

/** Checks that listing arguments are an object, as untyped callers may pass `null`. */
export function assertListArgs(args: unknown): asserts args is LooseListArgs {
    if (typeof args !== 'object' || args === null) {
        throw new ConfigurationError('The listing arguments must be an object.')
    }
}

/**
 * The `get_list` parameters for a listing. Checks every argument first, so a mistake is a
 * `ConfigurationError` and no request is sent. With `parent`, only the rows of that parent
 * DocType are returned.
 */
export function toListParams(args: unknown): ListParams {
    assertListArgs(args)
    const { fields, parent } = args
    if (fields !== undefined && !Array.isArray(fields)) {
        throw new ConfigurationError('`fields` must be an array of field names, or ["*"].')
    }
    if (parent !== undefined && (typeof parent !== 'string' || parent === '')) {
        throw new ConfigurationError('`parent` must be the name of the parent DocType.')
    }
    const filters = normalizeFilters(args.filters)
    // Frappe 15 returns child rows of every parent type for `parent`, Frappe 16 only this one's.
    if (parent !== undefined) filters.push(['parenttype', '=', parent])
    const orFilters = normalizeFilters(args.orFilters, '`orFilters`')
    const orderBy = toOrderBy(args.orderBy)
    const { groupBy } = args
    if (groupBy !== undefined) assertIdentifier(groupBy, '`groupBy`')
    return {
        // A copy: `paginate` reuses the parameters for every page.
        ...(fields === undefined ? {} : { fields: [...(fields as readonly unknown[])] }),
        ...(filters.length === 0 ? {} : { filters }),
        ...(orFilters.length === 0 ? {} : { or_filters: orFilters }),
        ...(orderBy === '' ? {} : { order_by: orderBy }),
        ...(groupBy === undefined ? {} : { group_by: groupBy }),
        limit_start: args.offset === undefined ? 0 : assertOffset(args.offset),
        limit_page_length: args.limit === undefined ? DEFAULT_LIMIT : assertPositiveInteger(args.limit, '`limit`'),
        ...(parent === undefined ? {} : { parent }),
    }
}

/** `orderBy` as Frappe's `order_by`: `field asc, other desc`; `''` for none. */
function toOrderBy(orderBy: unknown): string {
    if (orderBy === undefined) return ''
    const entries: readonly unknown[] = Array.isArray(orderBy) ? orderBy : [orderBy]
    return entries
        .map((entry) => {
            const { field, order = 'asc' } = Object(entry) as { field?: unknown; order?: unknown }
            assertIdentifier(field, '`orderBy` field')
            if (order !== 'asc' && order !== 'desc') {
                throw new ConfigurationError(`\`orderBy\` order must be "asc" or "desc"; got ${String(order)}.`)
            }
            return `${field} ${order}`
        })
        .join(', ')
}

function assertIdentifier(value: unknown, what: string): asserts value is string {
    if (typeof value !== 'string' || !identifier.test(value)) {
        throw new ConfigurationError(`${what} must be a field name such as "modified"; got ${String(value)}.`)
    }
}

/** Checks a count of rows, such as `limit` or `pageSize`. */
export function assertPositiveInteger(value: unknown, what: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new ConfigurationError(`${what} must be a positive integer; got ${String(value)}.`)
    }
    return value
}

function assertOffset(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new ConfigurationError(`\`offset\` must be an integer of 0 or more; got ${String(value)}.`)
    }
    return value
}

/**
 * Whether `path` with `query` can be sent as a GET: its path and query stay within
 * {@link MAX_GET_LENGTH}. Measured with the encoder the request itself uses, exactly as sent.
 */
export function fitsInGet(path: string, query: Readonly<Record<string, QueryValue>>): boolean {
    return buildUrl('', path, query).length <= MAX_GET_LENGTH
}
