// DocType metadata, as both sources (a live site and an app folder) produce it: the shape the
// generator reads, and the validation that turns a raw DocType record into it.

/**
 * One DocType's metadata, normalized: flags are booleans, and only what the generator reads is kept.
 * The keys are the DocType's own fields, as Frappe names them.
 */
export interface DocTypeMeta {
    /** The DocType's name, such as `'Sales Order'`. */
    name: string
    /** The module it belongs to, such as `'Selling'`. */
    module: string
    /** A child table: its rows live in a parent document's table field. */
    istable: boolean
    /** A single DocType, such as `System Settings`: one record, no table. */
    issingle: boolean
    /** Documents are submitted and cancelled (`docstatus` 1 and 2). */
    is_submittable: boolean
    /** The naming rule, such as `'hash'`, `'field:title'` or `'autoincrement'`, when it has one. */
    autoname?: string
    /** The DocType's description, when it has one. */
    description?: string
    /** The fields, in the form's order, including layout fields such as section breaks. */
    fields: readonly FieldMeta[]
}

/** One field of a DocType, normalized. The keys are the DocField's own fields, as Frappe names them. */
export interface FieldMeta {
    /** The field's name, the key it has in a document, such as `'customer'`. */
    fieldname: string
    /** Frappe's fieldtype, such as `'Link'` or `'Section Break'`. */
    fieldtype: string
    /** The label shown on the form, when it has one. */
    label?: string
    /** Link target, child DocType, Select options (one per line), or the Dynamic Link's DocType field. */
    options?: string
    /** Mandatory. */
    reqd: boolean
    /** Permission level: a user who cannot read this level never receives the field. */
    permlevel: number
    /** Virtual: computed by the server, not stored. */
    is_virtual: boolean
    /** Masked: users without the mask permission receive a placeholder such as `XXXXXXXX` (Frappe 16). */
    mask: boolean
    /** The field's description (the form's help text), when it has one. */
    description?: string
}

/**
 * Whether documents of this DocType are named by "Autoincrement", so their name is an integer. As
 * Frappe's `is_autoincremented`, a single DocType never is: its one record is named after the DocType.
 */
export function isAutoincremented(meta: DocTypeMeta): boolean {
    return !meta.issingle && meta.autoname === 'autoincrement'
}

type RawRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is RawRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A 0/1 flag, as Frappe sends it, or a boolean. Absent or `null` is false. */
function readFlag(record: RawRecord, key: string, where: string): boolean {
    const value = record[key]
    if (value === undefined || value === null || value === 0 || value === false) return false
    if (value === 1 || value === true) return true
    throw new TypeError(`${where}: \`${key}\` must be 0, 1 or a boolean.`)
}

/** An optional string. Absent, `null` and `''` are all "not set". */
function readString(record: RawRecord, key: string, where: string): string | undefined {
    const value = record[key]
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'string') return value
    throw new TypeError(`${where}: \`${key}\` must be a string.`)
}

function readRequiredString(record: RawRecord, key: string, where: string): string {
    const value = readString(record, key, where)
    if (value === undefined) throw new TypeError(`${where}: \`${key}\` must be a non-empty string.`)
    return value
}

/** Validates and normalizes one field. `position` locates it in messages until its name is known. */
function normalizeField(raw: unknown, position: string): FieldMeta {
    if (!isRecord(raw)) throw new TypeError(`${position} must be an object.`)
    const fieldname = readRequiredString(raw, 'fieldname', position)
    const where = `${position} (${fieldname})`
    const fieldtype = readRequiredString(raw, 'fieldtype', where)
    const label = readString(raw, 'label', where)
    const options = readString(raw, 'options', where)
    const description = readString(raw, 'description', where)
    const permlevel = raw['permlevel'] ?? 0
    if (typeof permlevel !== 'number' || !Number.isSafeInteger(permlevel) || permlevel < 0) {
        throw new TypeError(`${where}: \`permlevel\` must be a non-negative integer.`)
    }
    return {
        fieldname,
        fieldtype,
        ...(label === undefined ? {} : { label }),
        ...(options === undefined ? {} : { options }),
        reqd: readFlag(raw, 'reqd', where),
        permlevel,
        is_virtual: readFlag(raw, 'is_virtual', where),
        mask: readFlag(raw, 'mask', where),
        ...(description === undefined ? {} : { description }),
    }
}

/**
 * Validates one raw DocType record and normalizes it: 0/1 flags become booleans, keys the generator
 * does not read are dropped, and a missing flag counts as not set. The record is a DocType as Frappe
 * returns it from `frappe.desk.form.load.getdoctype` (one of its `docs`), or as an app stores it in
 * its DocType JSON file.
 *
 * @param raw - The DocType record.
 * @returns The normalized metadata.
 * @throws `TypeError` when the record is not DocType metadata: no `name`, `module` or `fields`, a field
 * without `fieldname` or `fieldtype`, or a value of the wrong type. The message names the DocType and
 * the field.
 *
 * @example
 * ```ts
 * const meta = normalizeDocType({
 *     name: 'ToDo',
 *     module: 'Desk',
 *     fields: [{ fieldname: 'description', fieldtype: 'Text Editor', label: 'Description', reqd: 1 }],
 * })
 * // { name: 'ToDo', module: 'Desk', istable: false, …, fields: [{ fieldname: 'description', reqd: true, … }] }
 * ```
 */
export function normalizeDocType(raw: unknown): DocTypeMeta {
    if (!isRecord(raw)) throw new TypeError('DocType metadata must be an object.')
    const name = readRequiredString(raw, 'name', 'DocType metadata')
    const where = `DocType '${name}'`
    const module = readRequiredString(raw, 'module', where)
    const autoname = readString(raw, 'autoname', where)
    const description = readString(raw, 'description', where)
    const fields = raw['fields']
    if (!Array.isArray(fields)) throw new TypeError(`${where}: \`fields\` must be an array.`)
    return {
        name,
        module,
        istable: readFlag(raw, 'istable', where),
        issingle: readFlag(raw, 'issingle', where),
        is_submittable: readFlag(raw, 'is_submittable', where),
        ...(autoname === undefined ? {} : { autoname }),
        ...(description === undefined ? {} : { description }),
        fields: fields.map((field: unknown, index) => normalizeField(field, `${where}, fields[${String(index)}]`)),
    }
}
