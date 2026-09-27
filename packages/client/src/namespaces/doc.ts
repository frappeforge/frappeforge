// `frappe.doc`: read documents — one by name, a single DocType's record, lists, counts, every
// matching row, single values, and checks on a document.

import { FrappeError, InvalidArgumentError } from '../errors.js'
import { isRecord, readMember } from '../http/decode.js'
import {
    assertFieldName,
    assertListArgs,
    assertParent,
    assertPositiveInteger,
    fitsInGet,
    type ListParams,
    normalizeFilters,
    toListParams,
} from '../http/list-query.js'
import type { ReadResponse, Send } from '../http/send.js'
import type {
    ColumnOf,
    DocOf,
    DocTypeName,
    FieldSelection,
    Filters,
    GetValueResult,
    ListArgs,
    ListRow,
    PaginateArgs,
    PermissionType,
    QueryValue,
    RegisteredDocTypes,
    RequestOptions,
    ValueField,
} from '../types.js'

/**
 * `frappe.doc`: read documents, single values, and checks on a document. Function properties, so
 * they can be destructured.
 *
 * DocType names autocomplete from generated types (see `Register`), field names and filter
 * values are checked against them, and a list returns exactly the fields it asks for. A DocType
 * that was not generated is accepted too, with `unknown` values.
 *
 * Every method rejects with a `FrappeError` subclass: `NotFoundError`, `PermissionError`, the
 * other status errors, `TimeoutError`, `AbortError`, `NetworkError`, or
 * `InvalidArgumentError` — before any request — for an invalid argument.
 *
 * A document name is a string, or a positive integer for DocTypes named by "Autoincrement". A
 * Link field holds such a name as a string, so every method accepts either form for any DocType.
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
    readonly get: <K extends DocTypeName<D>>(
        doctype: K,
        name: string | number,
        options?: RequestOptions,
    ) => Promise<DocOf<D, K>>
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
     * const open = await frappe.doc.getList('ToDo', {
     *     fields: ['name', 'description', 'priority'],
     *     filters: { status: 'Open' },
     *     orderBy: { field: 'modified', order: 'desc' },
     *     limit: 50,
     * })
     * ```
     */
    readonly getList: <K extends DocTypeName<D>, const F extends FieldSelection<DocOf<D, K>> = readonly ['name']>(
        doctype: K,
        args?: ListArgs<DocOf<D, K>, F>,
        options?: RequestOptions,
    ) => Promise<ListRow<DocOf<D, K>, F>[]>
    /**
     * Counts the documents that match the filters. Sent as a POST when the path and query string
     * would exceed 3800 characters, as `getList` does.
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
     * with `AbortError` before the next request. A DocType whose list ignores the filter on
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
    /**
     * Reads one or several fields of the first document that matches: by name, or by filters. The
     * value is `null` when no document matches, or when the user's permissions hide it.
     *
     * With one field, the result is its value, `null` when empty — pass `['field']` to tell an
     * empty field from a missing document. With several, it is a row, as `getList` returns them.
     * When several documents match, the first in the DocType's default sort order wins; use
     * `getList({ filters, orderBy, limit: 1 })` to choose one.
     *
     * A child table's rows need `parent`, the parent DocType, as `getList` does; only rows of that
     * DocType are read. For a single DocType, use `getSingleValue`: Frappe ignores the name and
     * filters of a single, and Frappe 15 answers every value as a string.
     *
     * @param doctype - The DocType, such as `'ToDo'`.
     * @param nameOrFilters - The document's name, or filters as `getList` takes them.
     * @param fields - A field name, or a list of them.
     * @param options - `parent` for a child table; a signal, and a timeout or headers for this
     * request only.
     *
     * @example
     * ```ts
     * const status = await frappe.doc.getValue('ToDo', 'TODO-0001', 'status')
     * const row = await frappe.doc.getValue('ToDo', { status: 'Open' }, ['name', 'allocated_to'])
     * const role = await frappe.doc.getValue('Has Role', { parent: 'user@example.com' }, 'role', { parent: 'User' })
     * ```
     */
    readonly getValue: <
        K extends DocTypeName<D>,
        const F extends ValueField<DocOf<D, K>> | readonly ValueField<DocOf<D, K>>[],
    >(
        doctype: K,
        nameOrFilters: string | number | Filters<DocOf<D, K>>,
        fields: F,
        options?: RequestOptions & Pick<ListArgs<DocOf<D, K>>, 'parent'>,
    ) => Promise<GetValueResult<DocOf<D, K>, F> | null>
    /**
     * Reads one field of a single DocType, such as `System Settings`, cast to the field's type.
     * Frappe casts a value never set too: `''` for text, select and link fields — so the result
     * type includes `''` — `0` for numbers and checks, `'0001-01-01'` for dates. Other types, such
     * as Attach, are `null`.
     *
     * @param doctype - The single DocType.
     * @param field - The field name.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const country = await frappe.doc.getSingleValue('System Settings', 'country')
     * ```
     */
    readonly getSingleValue: <K extends DocTypeName<D>, F extends ColumnOf<DocOf<D, K>>>(
        doctype: K,
        field: F,
        options?: RequestOptions,
    ) => Promise<
        Exclude<DocOf<D, K>[F], undefined> | null | ([Extract<DocOf<D, K>[F], string>] extends [never] ? never : '')
    >
    /**
     * Whether a document exists: by name, or by filters. A user without read permission on the
     * DocType gets a `PermissionError`, not `false`. A child table's rows need `parent`, as in
     * `getValue`. A single DocType always exists: Frappe ignores the name and filters of a single.
     *
     * @param doctype - The DocType, such as `'User'`.
     * @param nameOrFilters - The document's name, or filters as `getList` takes them.
     * @param options - `parent` for a child table; a signal, and a timeout or headers for this
     * request only.
     *
     * @example
     * ```ts
     * if (await frappe.doc.exists('User', 'user@example.com')) {
     *     // …
     * }
     * ```
     */
    readonly exists: <K extends DocTypeName<D>>(
        doctype: K,
        nameOrFilters: string | number | Filters<DocOf<D, K>>,
        options?: RequestOptions & Pick<ListArgs<DocOf<D, K>>, 'parent'>,
    ) => Promise<boolean>
    /**
     * Whether the signed-in user has a permission on a document. Administrator has every
     * permission, even `submit` on a DocType that is not submittable. For anyone else, a document
     * that does not exist is a `NotFoundError`, not `false`.
     *
     * @param doctype - The DocType, such as `'ToDo'`.
     * @param name - The document's name.
     * @param permission - The permission type. Default `read`.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const canEdit = await frappe.doc.hasPermission('ToDo', 'TODO-0001', 'write')
     * ```
     */
    readonly hasPermission: (
        doctype: DocTypeName<D>,
        name: string | number,
        permission?: PermissionType,
        options?: RequestOptions,
    ) => Promise<boolean>
    /**
     * Checks a value for a Link field: the document's stored name and the requested fields, or
     * `null` when there is no such document. On MariaDB, names compare without regard to case, so
     * the name comes back in the case it was saved with; on PostgreSQL the case must match.
     *
     * Unlike Desk's link validation, it needs read permission on the DocType (Desk also accepts
     * `select`), and it does not apply a Link field's filters or custom query, which belong to a
     * Desk form.
     *
     * @param doctype - The DocType the Link field points at.
     * @param name - The value to check.
     * @param fields - Fields to read along with the name.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const user = await frappe.doc.validateLink('User', 'user@example.com', ['full_name'])
     * // { name: 'user@example.com', full_name: 'Test User' }, or null
     * ```
     */
    readonly validateLink: <K extends DocTypeName<D>, const F extends readonly ValueField<DocOf<D, K>>[] = readonly []>(
        doctype: K,
        name: string | number,
        fields?: F,
        options?: RequestOptions,
    ) => Promise<ListRow<DocOf<D, K>, readonly ['name', ...F]> | null>
    /**
     * Whether a cancelled document has been amended: `true` when an amendment exists. Also
     * `false` when the user cannot read the DocType. Sent as a POST, because Frappe 16 lets a
     * browser reuse the answer to a GET for up to 10 minutes.
     *
     * @param doctype - The DocType, such as `'Sales Invoice'`.
     * @param name - The cancelled document's name.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const amended = await frappe.doc.isAmended('Sales Invoice', 'SINV-0001')
     * ```
     */
    readonly isAmended: (doctype: DocTypeName<D>, name: string | number, options?: RequestOptions) => Promise<boolean>
    /**
     * Reads the decrypted value of a Password field. Only a System Manager may; anyone else gets
     * a `PermissionError`. A field with no stored password is a `ValidationError` (`417`,
     * "Password not found for …") from Frappe.
     *
     * The value is returned as it is and never logged; keep it out of logs and caches.
     *
     * @param doctype - The DocType, such as `'Email Account'`.
     * @param name - The document's name.
     * @param field - The Password field.
     * @param options - A signal, and a timeout or headers for this request only.
     *
     * @example
     * ```ts
     * const secret = await frappe.doc.getPassword('Email Account', 'Support', 'password')
     * ```
     */
    readonly getPassword: <K extends DocTypeName<D>>(
        doctype: K,
        name: string | number,
        field: ColumnOf<DocOf<D, K>>,
        options?: RequestOptions,
    ) => Promise<string>
}

/**
 * What the runtime object must be: exactly the methods of `DocNamespace`, none missing and none
 * extra. Their arguments are `unknown`, checked at runtime for callers without types; the typed
 * signatures come from the interface.
 */
type DocMethods = { readonly [K in keyof DocNamespace]: (...args: never[]) => unknown }

/** Paging of their own, which `paginate` does not accept: its order is its cursor. */
const pagingArgs = ['orderBy', 'groupBy', 'limit', 'offset'] as const

const DEFAULT_PAGE_SIZE = 100

/** Frappe's permission types. A `Record`, so that leaving one out is a compile error. */
const permissionTypes = {
    select: true,
    read: true,
    write: true,
    create: true,
    delete: true,
    submit: true,
    cancel: true,
    amend: true,
    print: true,
    email: true,
    report: true,
    import: true,
    export: true,
    share: true,
} as const satisfies Record<PermissionType, true>

/** Creates `frappe.doc` over the client's pipeline. */
export function createDocNamespace<D extends object>(send: Send): DocNamespace<D> {
    const listRows = async (
        doctype: unknown,
        params: ListParams,
        options: RequestOptions,
    ): Promise<readonly unknown[]> => {
        const doctypeName = assertDoctype(doctype)
        const path = `/api/resource/${encodeURIComponent(doctypeName)}`
        const query = { ...params }
        if (fitsInGet(path, query)) return send({ path, query }, options, readMember('data', isList, 'a list'))
        return send(
            { method: 'POST', path: '/api/method/frappe.client.get_list', body: { doctype: doctypeName, ...params } },
            options,
            readMember('message', isList, 'a list'),
        )
    }

    /** A whitelisted method, as a GET, or as a POST when its query would not fit in a URL. */
    const callMethod = async <T>(
        path: string,
        query: Readonly<Record<string, QueryValue>>,
        read: ReadResponse<T>,
        options: RequestOptions,
    ): Promise<T> =>
        fitsInGet(path, query)
            ? send({ path, query }, options, read)
            : send({ method: 'POST', path, body: query }, options, read)

    /** `get_value`: the row of the first match with `fields`, or `null`. */
    const getValueRow = async (
        doctype: unknown,
        nameOrFilters: unknown,
        fields: readonly string[],
        { parent, ...options }: RequestOptions & { readonly parent?: unknown },
    ): Promise<Readonly<Record<string, unknown>> | null> => {
        const doctypeName = assertDoctype(doctype)
        const filters = toLookupFilters(nameOrFilters)
        if (parent !== undefined) {
            assertParent(parent)
            // Frappe 15 reads child rows of every parent type for `parent`, Frappe 16 only this one's.
            filters.push(['parenttype', '=', parent])
        }
        const row = await callMethod(
            '/api/method/frappe.client.get_value',
            // `fieldname` is always a list, so Frappe always answers an object.
            { doctype: doctypeName, fieldname: fields, filters, ...(parent === undefined ? {} : { parent }) },
            readMember('message', isRecordOrMissing, 'an object'),
            options,
        )
        return row === undefined || Object.keys(row).length === 0 ? null : row
    }

    const namespace = {
        get: async (doctype: unknown, name: unknown, options: RequestOptions = {}) =>
            send(
                {
                    path: `/api/resource/${encodeURIComponent(assertDoctype(doctype))}/${encodeURIComponent(assertDocName(name))}`,
                },
                options,
                readMember('data', isRecord, 'a document'),
            ),
        getSingle: async (doctype: unknown, options: RequestOptions = {}) => {
            const encoded = encodeURIComponent(assertDoctype(doctype))
            return send(
                { path: `/api/resource/${encoded}/${encoded}` },
                options,
                readMember('data', isRecord, 'a document'),
            )
        },
        getList: async (doctype: unknown, args: unknown = {}, options: RequestOptions = {}) =>
            listRows(doctype, toListParams(args), options),
        count: async (doctype: unknown, filters?: unknown, options: RequestOptions = {}) => {
            const doctypeName = assertDoctype(doctype)
            const conditions = normalizeFilters(filters)
            const query = { doctype: doctypeName, ...(conditions.length === 0 ? {} : { filters: conditions }) }
            return callMethod(
                '/api/method/frappe.client.get_count',
                query,
                readMember('message', isCount, 'a number'),
                options,
            )
        },
        getValue: async (doctype: unknown, nameOrFilters: unknown, fields: unknown, options: RequestOptions = {}) => {
            if (Array.isArray(fields)) return getValueRow(doctype, nameOrFilters, assertFieldNames(fields), options)
            assertFieldName(fields, '`fields`')
            const row = await getValueRow(doctype, nameOrFilters, [fields], options)
            return row === null ? null : (row[fields] ?? null)
        },
        getSingleValue: async (doctype: unknown, field: unknown, options: RequestOptions = {}) => {
            const doctypeName = assertDoctype(doctype)
            assertFieldName(field, '`field`')
            const value = await callMethod(
                '/api/method/frappe.client.get_single_value',
                { doctype: doctypeName, field },
                readMember('message', isAny, 'a value'),
                options,
            )
            return value ?? null
        },
        exists: async (doctype: unknown, nameOrFilters: unknown, options: RequestOptions = {}) =>
            (await getValueRow(doctype, nameOrFilters, ['name'], options)) !== null,
        hasPermission: async (
            doctype: unknown,
            name: unknown,
            permission: unknown = 'read',
            options: RequestOptions = {},
        ) => {
            const doctypeName = assertDoctype(doctype)
            const docname = assertDocName(name)
            if (typeof permission !== 'string' || !Object.hasOwn(permissionTypes, permission)) {
                throw new InvalidArgumentError(
                    `\`permission\` must be one of ${Object.keys(permissionTypes).join(', ')}; got ${String(permission)}.`,
                )
            }
            const answer = await callMethod(
                '/api/method/frappe.client.has_permission',
                { doctype: doctypeName, docname, perm_type: permission },
                readMember('message', isPermissionAnswer, 'a boolean `has_permission`'),
                options,
            )
            return answer.has_permission
        },
        validateLink: async (doctype: unknown, name: unknown, fields: unknown = [], options: RequestOptions = {}) => {
            if (!Array.isArray(fields)) throw new InvalidArgumentError('`fields` must be an array of field names.')
            const fieldNames = ['name', ...assertFieldNames(fields, true)]
            return getValueRow(doctype, assertDocName(name), [...new Set(fieldNames)], options)
        },
        isAmended: async (doctype: unknown, name: unknown, options: RequestOptions = {}) => {
            const doctypeName = assertDoctype(doctype)
            // A POST: Frappe 16 marks the GET answer as cacheable for 10 minutes.
            const amendment = await send(
                {
                    method: 'POST',
                    path: '/api/method/frappe.client.is_document_amended',
                    body: { doctype: doctypeName, docname: assertDocName(name) },
                },
                options,
                readMember('message', isAmendment, 'a name, null or false'),
            )
            // The amendment's name — a number for DocTypes named by "Autoincrement"; `null` when there
            // is none, `false` when the DocType is not readable.
            return typeof amendment === 'number' || (typeof amendment === 'string' && amendment !== '')
        },
        getPassword: async (doctype: unknown, name: unknown, field: unknown, options: RequestOptions = {}) => {
            const doctypeName = assertDoctype(doctype)
            const docname = assertDocName(name)
            assertFieldName(field, '`field`')
            return callMethod(
                '/api/method/frappe.client.get_password',
                { doctype: doctypeName, name: docname, fieldname: field },
                readMember('message', isString, 'a string'),
                options,
            )
        },
        paginate: async function* (
            doctype: unknown,
            args: unknown = {},
            options: RequestOptions = {},
        ): AsyncGenerator<unknown, void, undefined> {
            assertListArgs(args)
            const rejectedArg = pagingArgs.find((key) => args[key] !== undefined)
            if (rejectedArg !== undefined) {
                throw new InvalidArgumentError(
                    `paginate() sorts and pages by \`name\` itself; \`${rejectedArg}\` is not accepted.`,
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
                const found = await listRows(doctype, params, options)
                if (found.length < size) {
                    yield* found
                    return
                }
                // Checked before the page is yielded, so that no row is ever repeated.
                const next = rowName(found.at(-1))
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
    } satisfies DocMethods
    // The methods are the same for every DocType map: `D` only types their arguments and results.
    return Object.freeze(namespace) as unknown as DocNamespace<D>
}

/**
 * A DocType name: a non-empty string. It goes into the path through `encodeURIComponent`, so `/`,
 * `#`, `?` and `%` are safe.
 */
function assertDoctype(value: unknown): string {
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
function assertDocName(value: unknown): string {
    if (typeof value === 'string' && value !== '') return value
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
    throw new InvalidArgumentError('`name` must be a non-empty string or a positive integer.')
}

/**
 * The filters of a single-document read: a name becomes a filter on `name`, because Frappe would
 * parse a bare name such as `123` or `true` as JSON. Filters must not be empty: they would match
 * an arbitrary document.
 */
function toLookupFilters(nameOrFilters: unknown): unknown[][] {
    if (typeof nameOrFilters === 'string' || typeof nameOrFilters === 'number') {
        return [['name', '=', assertDocName(nameOrFilters)]]
    }
    const conditions = normalizeFilters(nameOrFilters, 'The name or filters')
    if (conditions.length === 0) throw new InvalidArgumentError('The name or filters must not be empty.')
    return conditions
}

/** Field names to read: identifiers, at least one unless `emptyAllowed`. `*` is not one. */
function assertFieldNames(fields: readonly unknown[], emptyAllowed = false): string[] {
    if (fields.length === 0 && !emptyAllowed) throw new InvalidArgumentError('`fields` must name at least one field.')
    return fields.map((field) => {
        assertFieldName(field, 'Each field')
        return field
    })
}

/** A row's `name`: a string, or a number for DocTypes named by `autoincrement`. */
function rowName(row: unknown): string | number | undefined {
    const name = isRecord(row) ? row['name'] : undefined
    return typeof name === 'string' || typeof name === 'number' ? name : undefined
}

function isList(value: unknown): value is readonly unknown[] {
    return Array.isArray(value)
}

function isCount(value: unknown): value is number {
    return typeof value === 'number'
}

function isString(value: unknown): value is string {
    return typeof value === 'string'
}

/** Frappe leaves `message` out when a method returns `None`. */
function isRecordOrMissing(value: unknown): value is Readonly<Record<string, unknown>> | undefined {
    return value === undefined || isRecord(value)
}

function isPermissionAnswer(value: unknown): value is { readonly has_permission: boolean } {
    return isRecord(value) && typeof value['has_permission'] === 'boolean'
}

function isAny(_value: unknown): _value is unknown {
    return true
}

function isAmendment(value: unknown): value is string | number | false | null | undefined {
    return (
        typeof value === 'string' ||
        typeof value === 'number' ||
        value === false ||
        value === null ||
        value === undefined
    )
}
