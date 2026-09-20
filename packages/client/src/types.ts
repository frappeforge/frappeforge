/**
 * The core type vocabulary every resource is built on.
 *
 * Nothing in this module exists at runtime. It describes the shape of Frappe documents, the
 * arguments list queries accept, and the options every call accepts.
 */

/**
 * The fields Frappe assigns to every stored document, whatever its DocType.
 *
 * Date and datetime fields are left as the strings the server returns. They are naive — they
 * carry no timezone — so converting them to a `Date` would have to invent one. Parse them in
 * application code, where the site's timezone is known.
 */
export interface FrappeDoc {
    /** The DocType this document belongs to. */
    doctype: string
    /** Primary key. Either a generated series value or a field of the document itself. */
    name: string
    /** User who created the document. */
    owner: string
    /** Creation timestamp, as returned by the server. */
    creation: string
    /** Last modification timestamp, as returned by the server. */
    modified: string
    /** User who last modified the document. */
    modified_by: string
    /** Position within a parent document. Meaningful for child table rows. */
    idx: number
    /** `0` draft, `1` submitted, `2` cancelled. */
    docstatus: 0 | 1 | 2
    /** Name of the parent document, when this is a child table row. */
    parent?: string
    /** Field on the parent that holds this row, when this is a child table row. */
    parentfield?: string
    /** DocType of the parent document, when this is a child table row. */
    parenttype?: string
}

/**
 * A map of DocType name to the interface describing it.
 *
 * `@frappeforge/codegen` emits one of these as a type alias, which is what lets a client
 * infer document shapes from a DocType name.
 *
 * @example
 * ```ts
 * export type DocTypes = {
 *     Task: Task
 *     Project: Project
 * }
 * ```
 */
export type DocTypeMap = Record<string, FrappeDoc>

/**
 * Resolves a DocType name against a generated map, falling back to the untyped
 * {@link FrappeDoc} when the name is not in the map.
 */
export type DocOf<D, K extends string> = K extends keyof D ? (D[K] extends FrappeDoc ? D[K] : FrappeDoc) : FrappeDoc

/** The string-keyed field names of a document interface. */
export type FieldOf<T> = Extract<keyof T, string>

/** Comparison operators accepted in a filter tuple. */
export type FilterOperator =
    '=' | '!=' | '>' | '<' | '>=' | '<=' | 'like' | 'not like' | 'in' | 'not in' | 'is' | 'between'

/** A value a filter can compare against. Arrays are for `in`, `not in` and `between`. */
export type FilterValue = string | number | boolean | null | readonly (string | number)[]

/** A single field, operator and value, for filters that need more than equality. */
export type FilterTuple<T> = readonly [field: FieldOf<T>, operator: FilterOperator, value: FilterValue]

/**
 * Either the shorthand object form, where every entry is an equality test, or an array of
 * tuples when an operator is needed. Field names are checked against the document either way.
 *
 * @example
 * ```ts
 * const byStatus = { status: 'Open' }
 * const byPriority = [['priority', '>', 2]] as const
 * ```
 */
export type Filters<T> = Partial<Record<FieldOf<T>, FilterValue>> | readonly FilterTuple<T>[]

/** Which field to sort a listing by, and in which direction. */
export interface OrderBy<T> {
    /** Field to sort by. */
    field: FieldOf<T>
    /** Defaults to `asc`. */
    order?: 'asc' | 'desc'
}

/** Arguments accepted by document listings. */
export interface ListArgs<T> {
    /** Fields to return. Defaults to the document's name only, as Frappe does. */
    fields?: readonly FieldOf<T>[]
    /** Conditions combined with `AND`. */
    filters?: Filters<T>
    /** Conditions combined with `OR`, applied alongside `filters`. */
    orFilters?: Filters<T>
    /** Sort order. */
    orderBy?: OrderBy<T>
    /** Field to group results by. */
    groupBy?: FieldOf<T>
    /** Maximum number of rows to return. */
    limit?: number
    /** Number of rows to skip before collecting results. */
    offset?: number
    /** Parent DocType, required when listing child table rows. */
    parent?: string
}

/**
 * Accepted as the last argument of every call, so cancellation and per-call overrides never
 * need a separate API.
 */
export interface RequestOptions {
    /** Aborts this request. Composed with the client's configured timeout. */
    signal?: AbortSignal
    /** Overrides the client's timeout for this request only, in milliseconds. */
    timeout?: number
    /** Headers merged over the client's own for this request only. */
    headers?: Record<string, string>
}
