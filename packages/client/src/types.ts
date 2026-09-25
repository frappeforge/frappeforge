// The core type vocabulary every resource is built on. Nothing here exists at runtime: it describes
// Frappe documents, list arguments, write input and per-call options. (A line comment, so it does not
// end up as an orphaned block in the bundled .d.ts.)

// ── Documents ──────────────────────────────────────────────────────────────────────────────

/**
 * The fields Frappe assigns to every stored document, whatever its DocType.
 *
 * Date and datetime fields are left as the strings the server returns. They are naive — they
 * carry no timezone — so converting them to a `Date` would have to invent one. Parse them in
 * application code, where the site's timezone is known.
 */
export interface FrappeDoc {
    /** The DocType this document belongs to. Not a database column, so lists never return it. */
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
    /** Name of the parent document. Exists only on child table rows. */
    parent?: string
    /** Field on the parent that holds this row. Exists only on child table rows. */
    parentfield?: string
    /** DocType of the parent document. Exists only on child table rows. */
    parenttype?: string
    /** Tags, as a comma-separated string. Exists only on documents that are not child rows. */
    _user_tags?: string | null
    /** Recent comments, as a JSON string. Exists only on documents that are not child rows. */
    _comments?: string | null
    /** Assigned users, as a JSON string. Exists only on documents that are not child rows. */
    _assign?: string | null
    /** Users who liked the document, as a JSON string. Exists only on documents that are not child rows. */
    _liked_by?: string | null
}

/**
 * The registry that makes every API typed without generics.
 *
 * `@frappeforge/codegen` augments it with the generated DocType map. Until then it is empty and
 * every DocType is typed as an {@link UnknownDoc}.
 *
 * @example
 * ```ts
 * declare module '@frappeforge/client' {
 *     interface Register {
 *         docTypes: DocTypes
 *     }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface Register {}

/** The DocType map from {@link Register}, or `object` — no known DocTypes — when none is registered. */
export type RegisteredDocTypes = Register extends { docTypes: infer D extends object } ? D : object

/**
 * A DocType name: generated names autocomplete, and any other string is accepted, because real
 * apps call DocTypes they never generated.
 */
export type DocTypeName<D extends object> = Extract<keyof D, string> | (string & {})

/**
 * A document whose DocType was not generated: the standard fields keep their types, and any
 * other field is accepted with an `unknown` value, so nothing is falsely typed.
 */
export type UnknownDoc = FrappeDoc & Record<string, unknown>

/**
 * Resolves a DocType name against a DocType map, falling back to {@link UnknownDoc} for a name
 * that is not in the map.
 */
export type DocOf<D extends object, K extends string> = K extends keyof D
    ? D[K] extends FrappeDoc
        ? D[K]
        : UnknownDoc
    : UnknownDoc

// ── Fields and rows ────────────────────────────────────────────────────────────────────────

/** The string-keyed field names of a document interface. */
export type FieldOf<T> = Extract<keyof T, string>

/**
 * The child-table fields of a document interface — those holding an array of rows. A field typed
 * `any` is not one.
 */
export type TableFieldOf<T> = {
    [K in FieldOf<T>]-?: 0 extends 1 & T[K] ? never : NonNullable<T[K]> extends readonly FrappeDoc[] ? K : never
}[FieldOf<T>]

/**
 * The standard columns a DocType's table does not have. `parent`, `parentfield` and `parenttype`
 * exist only on child tables, and `_user_tags`, `_comments`, `_assign` and `_liked_by` only on
 * the others. A child table is one whose interface declares `parent` as required, as generated
 * code does. For a DocType that was not generated the kind is unknown, so nothing is left out.
 */
export type AbsentColumn<T> =
    string extends FieldOf<T>
        ? never
        : [T] extends [{ parent: string }]
          ? '_user_tags' | '_comments' | '_assign' | '_liked_by'
          : 'parent' | 'parentfield' | 'parenttype'

/**
 * The fields a list query can return, filter, sort and group by: the database columns. Child
 * tables are left out, because lists never return child rows, and so are `doctype`, which is not
 * a column, and the standard columns the table does not have ({@link AbsentColumn}).
 */
export type ListFieldOf<T> = Exclude<FieldOf<T>, TableFieldOf<T> | 'doctype' | AbsentColumn<T>>

/**
 * Which columns a list returns: some fields, or `['*']` for every column.
 *
 * `'name'` is always allowed, even while the document type is still generic, so that a
 * default of `['name']` — what Frappe returns when no fields are asked for — always type-checks.
 */
export type FieldSelection<T> = readonly (ListFieldOf<T> | 'name')[] | readonly ['*']

/**
 * One row of a list result: the requested columns, or every column with `['*']`. Child tables
 * and `doctype` never appear.
 *
 * Standard columns are always present; an empty one comes back as `null`. `['*']` does not
 * return `_user_tags`, `_comments`, `_assign` or `_liked_by` — ask for them by name. Other fields
 * keep the optionality the document interface declares, because a list leaves out every field
 * the user cannot read at its permission level — and an interface cannot tell those fields apart
 * from ones that are merely empty.
 *
 * @example
 * ```ts
 * type Row = ListRow<Task, readonly ['name', 'subject', 'status']>
 * // { name: string; subject: string; status?: 'Open' | 'Completed' | null }
 * ```
 */
export type ListRow<T, F extends FieldSelection<T>> = (
    F extends readonly ['*'] ? ListFieldOf<T> : F[number] & ListFieldOf<T>
) extends infer C extends string
    ? Exclude<
          C & keyof FrappeDoc,
          'doctype' | (F extends readonly ['*'] ? '_user_tags' | '_comments' | '_assign' | '_liked_by' : never)
      > extends infer S extends keyof FrappeDoc
        ? (
              string extends FieldOf<T>
                  ? Record<Exclude<C, keyof FrappeDoc>, unknown> & Pick<FrappeDoc, S>
                  : { [P in keyof T as P extends Exclude<C, keyof FrappeDoc> ? P : never]: T[P] } & {
                        [P in S]: Exclude<(T & FrappeDoc)[P], undefined>
                    }
          ) extends infer R
            ? { [K in keyof R]: R[K] }
            : never
        : never
    : never

// ── Filters ────────────────────────────────────────────────────────────────────────────────

/** The periods Frappe's `timespan` operator understands, relative to today on the server. */
export type Timespan =
    | 'last 7 days'
    | 'last 14 days'
    | 'last 30 days'
    | 'last 90 days'
    | 'last week'
    | 'last month'
    | 'last quarter'
    | 'last 6 months'
    | 'last year'
    | 'yesterday'
    | 'today'
    | 'tomorrow'
    | 'this week'
    | 'this month'
    | 'this quarter'
    | 'this year'
    | 'next 7 days'
    | 'next 14 days'
    | 'next 30 days'
    | 'next week'
    | 'next month'
    | 'next quarter'
    | 'next 6 months'
    | 'next year'

/**
 * An operator and its value. The value's type follows the operator: `in` takes an array,
 * `between` a pair, `is` either `set` or `not set`, `timespan` a {@link Timespan}.
 *
 * Booleans are sent as `1` / `0`.
 */
export type FilterCondition =
    | readonly ['=' | '!=' | '>' | '<' | '>=' | '<=' | 'like' | 'not like', string | number | boolean | null]
    | readonly ['in' | 'not in', readonly (string | number)[]]
    | readonly ['is', 'set' | 'not set']
    | readonly ['between', readonly [string | number, string | number]]
    | readonly ['timespan', Timespan]
    | readonly ['descendants of' | 'not descendants of' | 'ancestors of' | 'not ancestors of', string]

/**
 * The value an equality filter accepts for a field of type `V`: the field's own values or
 * `null`. A Check field (`0 | 1`) also accepts a boolean, sent as `1` / `0`. A field whose type
 * is unknown accepts any scalar.
 */
export type EqualityValue<V> = unknown extends V
    ? string | number | boolean | null
    : [NonNullable<V>] extends [0 | 1]
      ? 0 | 1 | boolean
      : Exclude<V, undefined> | null

/**
 * The object form of filters: a value means equality and is checked against the field's type;
 * `[operator, value]` means an operator. For a DocType that was not generated, the standard
 * columns are still checked.
 *
 * An array is always read as `[operator, value]`, so `{ status: ['Open', 'Closed'] }` is not
 * an `in` filter — write `{ status: ['in', ['Open', 'Closed']] }`.
 *
 * @example
 * ```ts
 * const filters: FilterObject<Task> = { status: 'Open', priority: ['>', 2] }
 * ```
 */
export type FilterObject<T> =
    string extends FieldOf<T>
        ? {
              readonly [K in Exclude<keyof FrappeDoc, 'doctype'>]?: EqualityValue<FrappeDoc[K]> | FilterCondition
          } & Readonly<Record<string, EqualityValue<unknown> | FilterCondition>>
        : { readonly [K in ListFieldOf<T>]?: EqualityValue<T[K]> | FilterCondition }

/**
 * A filter on a child-table field: `[childDocType, field, operator, value]`. Matches documents
 * with at least one row that satisfies it.
 *
 * @example
 * ```ts
 * const filter: ChildFilterTuple<Task> = ['Task Depends On', 'task', '=', 'TASK-0001']
 * ```
 */
export type ChildFilterTuple<T> =
    string extends FieldOf<T>
        ? readonly [childDocType: string, field: string, ...condition: FilterCondition]
        : {
              [K in TableFieldOf<T>]-?: NonNullable<T[K]> extends readonly (infer C extends FrappeDoc)[]
                  ? readonly [childDocType: C['doctype'], field: ListFieldOf<C>, ...condition: FilterCondition]
                  : never
          }[TableFieldOf<T>]

/**
 * One filter in the tuple form: `[field, operator, value]`; the same with the DocType's own name
 * first, as Desk writes them; or a {@link ChildFilterTuple}.
 *
 * Field names are checked, and values are checked against the operator, but not against the
 * field's own type: over a DocType with hundreds of fields, that produces compiler errors too
 * long to read. The object form, {@link FilterObject}, checks values per field.
 */
export type FilterTuple<T> =
    | readonly [field: ListFieldOf<T>, ...condition: FilterCondition]
    | (T extends { doctype: infer N extends string }
          ? readonly [docType: N, field: ListFieldOf<T>, ...condition: FilterCondition]
          : never)
    | ChildFilterTuple<T>

/**
 * Either the object form, or an array of tuples. Field names are checked against the document
 * either way.
 *
 * @example
 * ```ts
 * const byStatus: Filters<Task> = { status: 'Open' }
 * const byPriority: Filters<Task> = [['priority', '>', 2], ['Task Depends On', 'task', '=', 'TASK-0001']]
 * ```
 */
export type Filters<T> = FilterObject<T> | readonly FilterTuple<T>[]

// ── Arguments ──────────────────────────────────────────────────────────────────────────────

/** Which field to sort a listing by, and in which direction. */
export interface OrderBy<T> {
    /** Field to sort by. */
    field: ListFieldOf<T>
    /** Defaults to `asc`. */
    order?: 'asc' | 'desc'
}

/** Arguments accepted by document listings. */
export interface ListArgs<T, F extends FieldSelection<T> = FieldSelection<T>> {
    /** Columns to return, or `['*']` for every column. Defaults to the document's name only, as Frappe does. */
    fields?: F
    /** Conditions combined with `AND`. */
    filters?: Filters<T>
    /** Conditions combined with `OR`, applied alongside `filters`. */
    orFilters?: Filters<T>
    /** Sort order: one field, or several in priority order. */
    orderBy?: OrderBy<T> | readonly OrderBy<T>[]
    /** Field to group results by. */
    groupBy?: ListFieldOf<T>
    /**
     * Rows to return: a positive integer, default 20. Frappe reads `0` as "no limit", so this
     * client never sends it — use `paginate` to read everything.
     */
    limit?: number
    /** Number of rows to skip before collecting results. */
    offset?: number
    /** Parent DocType, required when listing child table rows. */
    parent?: string
}

/**
 * Fields the server assigns, which writes never accept. `docstatus` is among them: it changes
 * through `submit` and `cancel`.
 */
export type ServerField =
    | 'doctype'
    | 'owner'
    | 'creation'
    | 'modified'
    | 'modified_by'
    | 'idx'
    | 'docstatus'
    | 'parent'
    | 'parentfield'
    | 'parenttype'
    | '_user_tags'
    | '_comments'
    | '_assign'
    | '_liked_by'

/**
 * What `create` and `update` accept.
 *
 * Every field is optional, because Frappe checks mandatory fields only after the DocType's
 * `validate` hooks, which often fill them. Server-assigned fields ({@link ServerField}) are
 * removed. `name` is allowed, for DocTypes named by the caller. Child rows take the same shape;
 * on update, a child table replaces the whole table: rows with a `name` are kept and updated,
 * rows without one are inserted, and rows left out are deleted.
 *
 * @example
 * ```ts
 * const input: DocInput<SalesInvoice> = { customer: 'ACME', items: [{ item_code: 'X', qty: 1 }] }
 * ```
 */
export type DocInput<T> = {
    [K in keyof T as K extends ServerField ? never : K]?: NonNullable<T[K]> extends readonly (infer C extends
        FrappeDoc)[]
        ? readonly DocInput<C>[]
        : T[K]
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

/**
 * A value accepted in {@link RawRequest.query}. Strings are sent as they are, numbers via
 * `String`, booleans as `1` / `0`, and arrays and objects as JSON; `null` and `undefined` are
 * left out of the query string. A `Date` is an object too, so it would be sent as quoted JSON:
 * pass dates as strings, such as `'2026-01-31'`.
 */
export type QueryValue = string | number | boolean | null | undefined | readonly unknown[] | object

/** A request to any Frappe endpoint, sent through the client's pipeline by `request()`. */
export interface RawRequest {
    /** HTTP method. Default `GET`. */
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    /**
     * Absolute path on the site, starting with `/`, e.g. `/api/method/frappe.ping`. Put
     * parameters in `query`, never in the path: a `?` or `#` here is rejected, as are
     * whitespace, `\` and `.` or `..` segments, which the URL parser would rewrite.
     */
    path: string
    /** Encoded as the query string, as described for {@link QueryValue}. */
    query?: Readonly<Record<string, QueryValue>>
    /**
     * Plain values are sent as JSON; `FormData` is sent as multipart. Any other `fetch` body
     * (`Blob`, `URLSearchParams`, binary data, a stream) is rejected.
     */
    body?: unknown
}
