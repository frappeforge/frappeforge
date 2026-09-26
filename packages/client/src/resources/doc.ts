// `frappe.doc`: read documents — one by name, a single DocType's record, lists, counts, and every
// matching row.

import { ConfigurationError, FrappeError } from '../errors.js'
import { isRecord, readMember } from '../http/decode.js'
import {
    assertListArgs,
    assertPositiveInteger,
    fitsInGet,
    type ListParams,
    normalizeFilters,
    toListParams,
} from '../http/list-query.js'
import type { Send } from '../http/send.js'
import type {
    DocOf,
    DocTypeName,
    FieldSelection,
    Filters,
    ListArgs,
    ListRow,
    PaginateArgs,
    RegisteredDocTypes,
    RequestOptions,
} from '../types.js'

/**
 * `frappe.doc`: read documents. Function properties, so they can be destructured.
 *
 * DocType names autocomplete from generated types (see `Register`), field names and filter
 * values are checked against them, and a list returns exactly the fields it asks for. A DocType
 * that was not generated is accepted too, with `unknown` values.
 *
 * Every method rejects with a `FrappeError` subclass: `NotFoundError`, `PermissionError`, the
 * other status errors, `TimeoutError`, `CancelledError`, `NetworkError`, or
 * `ConfigurationError` — before any request — for an invalid argument.
 */
export interface DocNamespace<D extends object = RegisteredDocTypes> {
    /**
     * Reads one document by name, with its child tables. Empty fields are absent from the result,
     * as Frappe leaves them out of documents.
     *
     * @param doctype - The DocType, such as `'ToDo'`.
     * @param name - The document's name. Any characters are allowed; it is encoded for the URL.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const todo = await frappe.doc.get('ToDo', 'TODO-0001')
     * ```
     */
    readonly get: <K extends DocTypeName<D>>(doctype: K, name: string, options?: RequestOptions) => Promise<DocOf<D, K>>
    /**
     * Reads the record of a single DocType, such as `System Settings`.
     *
     * @param doctype - The single DocType.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const settings = await frappe.doc.getSingle('System Settings')
     * ```
     */
    readonly getSingle: <K extends DocTypeName<D>>(doctype: K, options?: RequestOptions) => Promise<DocOf<D, K>>
    /**
     * Lists documents: one page of rows with the requested fields — `name` alone when `fields`
     * is left out, and 20 rows unless `limit` says otherwise. Empty columns come back as `null`.
     *
     * A query whose path and query string would exceed 3800 characters, such as a long `in`
     * filter, is sent as a POST to `frappe.client.get_list` instead, with the same result.
     *
     * @param doctype - The DocType, such as `'ToDo'`.
     * @param args - Fields, filters, order, grouping and paging.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const open = await frappe.doc.list('ToDo', {
     *     fields: ['name', 'description', 'priority'],
     *     filters: { status: 'Open' },
     *     orderBy: { field: 'modified', order: 'desc' },
     *     limit: 50,
     * })
     * ```
     */
    readonly list: <K extends DocTypeName<D>, const F extends FieldSelection<DocOf<D, K>> = readonly ['name']>(
        doctype: K,
        args?: ListArgs<DocOf<D, K>, F>,
        options?: RequestOptions,
    ) => Promise<ListRow<DocOf<D, K>, F>[]>
    /**
     * Counts the documents that match the filters. Sent as a POST when the path and query string
     * would exceed 3800 characters, as `list` does.
     *
     * @param doctype - The DocType, such as `'ToDo'`.
     * @param filters - Conditions combined with `AND`; every document when left out.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const open = await frappe.doc.count('ToDo', { status: 'Open' })
     * ```
     */
    readonly count: <K extends DocTypeName<D>>(
        doctype: K,
        filters?: Filters<DocOf<D, K>>,
        options?: RequestOptions,
    ) => Promise<number>
    /**
     * Walks every matching row, one page per request, in `name` order. Each page continues after
     * the last `name` of the one before, instead of skipping rows by count, so documents created,
     * changed or deleted during the walk never cause a row to be skipped or repeated, and every
     * page is a fast index lookup.
     *
     * `name` is always in the rows, as it is the cursor. The walk stops after a page with fewer
     * than `pageSize` rows. The options apply to every request; aborting the signal ends the walk
     * with `CancelledError` before the next request. A DocType whose list ignores the filter on
     * `name`, such as a virtual DocType, ends it with a `FrappeError` rather than repeating rows.
     *
     * @param doctype - The DocType, such as `'Sales Invoice'`.
     * @param args - Fields, filters and the page size (default 100).
     * @param options - A signal, and a timeout or headers for each request.
     *
     * @example
     * ```ts
     * let total = 0
     * for await (const invoice of frappe.doc.paginate('Sales Invoice', {
     *     fields: ['grand_total'],
     *     filters: { docstatus: 1 },
     * })) {
     *     total += Number(invoice.grand_total)
     * }
     * ```
     */
    readonly paginate: <K extends DocTypeName<D>, const F extends FieldSelection<DocOf<D, K>> = readonly ['name']>(
        doctype: K,
        args?: PaginateArgs<DocOf<D, K>, F>,
        options?: RequestOptions,
    ) => AsyncGenerator<ListRow<DocOf<D, K>, F extends readonly ['*'] ? F : readonly [...F, 'name']>, void, undefined>
}

/** Paging of their own, which `paginate` does not accept: its order is its cursor. */
const pagingArgs = ['orderBy', 'groupBy', 'limit', 'offset'] as const

const DEFAULT_PAGE_SIZE = 100

/** Creates `frappe.doc` over the client's pipeline. */
export function createDocNamespace<D extends object>(send: Send): DocNamespace<D> {
    const rows = async (doctype: unknown, params: ListParams, options: RequestOptions): Promise<readonly unknown[]> => {
        const doctypeName = required(doctype, '`doctype`')
        const path = `/api/resource/${encodeURIComponent(doctypeName)}`
        const query = { ...params }
        if (fitsInGet(path, query)) return send({ path, query }, options, readMember('data', isList, 'a list'))
        return send(
            { method: 'POST', path: '/api/method/frappe.client.get_list', body: { doctype: doctypeName, ...params } },
            options,
            readMember('message', isList, 'a list'),
        )
    }

    const namespace = {
        get: async (doctype: unknown, name: unknown, options: RequestOptions = {}) =>
            send(
                {
                    path: `/api/resource/${encodeURIComponent(required(doctype, '`doctype`'))}/${encodeURIComponent(required(name, '`name`'))}`,
                },
                options,
                readMember('data', isRecord, 'a document'),
            ),
        getSingle: async (doctype: unknown, options: RequestOptions = {}) => {
            const encoded = encodeURIComponent(required(doctype, '`doctype`'))
            return send(
                { path: `/api/resource/${encoded}/${encoded}` },
                options,
                readMember('data', isRecord, 'a document'),
            )
        },
        list: async (doctype: unknown, args: unknown = {}, options: RequestOptions = {}) =>
            rows(doctype, toListParams(args), options),
        count: async (doctype: unknown, filters?: unknown, options: RequestOptions = {}) => {
            const doctypeName = required(doctype, '`doctype`')
            const conditions = normalizeFilters(filters)
            const query = { doctype: doctypeName, ...(conditions.length === 0 ? {} : { filters: conditions }) }
            const path = '/api/method/frappe.client.get_count'
            const read = readMember('message', isCount, 'a number')
            if (fitsInGet(path, query)) return send({ path, query }, options, read)
            return send({ method: 'POST', path, body: query }, options, read)
        },
        paginate: async function* (
            doctype: unknown,
            args: unknown = {},
            options: RequestOptions = {},
        ): AsyncGenerator<unknown, void, undefined> {
            assertListArgs(args)
            const own = pagingArgs.find((key) => args[key] !== undefined)
            if (own !== undefined) {
                throw new ConfigurationError(
                    `paginate() sorts and pages by \`name\` itself; \`${own}\` is not accepted.`,
                )
            }
            const { fields, filters, orFilters, parent, pageSize = DEFAULT_PAGE_SIZE } = args
            const size = assertPositiveInteger(pageSize, '`pageSize`')
            // `name` is the cursor. Without `fields`, Frappe returns `name` alone.
            const selection =
                !isList(fields) || fields.includes('*') || fields.includes('name') ? fields : [...fields, 'name']
            // Built once: each later page only adds the cursor to the filters.
            const first = toListParams({
                fields: selection,
                filters,
                orFilters,
                parent,
                orderBy: { field: 'name' },
                limit: size,
            })
            const conditions = first.filters ?? []
            let cursor: string | number | undefined
            for (;;) {
                const params =
                    cursor === undefined ? first : { ...first, filters: [...conditions, ['name', '>', cursor]] }
                const found = await rows(doctype, params, options)
                if (found.length < size) {
                    yield* found
                    return
                }
                // Checked before the page is yielded, so that no row is ever repeated.
                const next = nameOf(found.at(-1))
                if (next === undefined) {
                    throw new FrappeError(
                        `paginate() cannot continue: the last row of a page of ${String(doctype)} has no \`name\`.`,
                    )
                }
                // A cursor that does not advance would ask for the same page forever, e.g. from a
                // virtual DocType that ignores filters.
                if (next === cursor) {
                    throw new FrappeError(
                        `paginate() cannot continue: ${String(doctype)} answered the same page twice, so its list ignores the filter on \`name\`.`,
                    )
                }
                yield* found
                cursor = next
            }
        },
    }
    // The methods are the same for every DocType map: `D` only types their arguments and results.
    return Object.freeze(namespace) as unknown as DocNamespace<D>
}

/**
 * A DocType or document name: a non-empty string. It goes into the path through
 * `encodeURIComponent`, so `/`, `#`, `?` and `%` are safe.
 */
function required(value: unknown, what: string): string {
    if (typeof value !== 'string' || value === '') throw new ConfigurationError(`${what} must be a non-empty string.`)
    return value
}

/** A row's `name`: a string, or a number for DocTypes named by `autoincrement`. */
function nameOf(row: unknown): string | number | undefined {
    const name = isRecord(row) ? row['name'] : undefined
    return typeof name === 'string' || typeof name === 'number' ? name : undefined
}

function isList(value: unknown): value is readonly unknown[] {
    return Array.isArray(value)
}

function isCount(value: unknown): value is number {
    return typeof value === 'number'
}
