// Fieldtype → TypeScript: the value's type, whether the key can be missing, and whether it can be
// `null`. Documents leave empty fields out, while list rows return them as `null`. Numbers and checks
// are stored `NOT NULL DEFAULT 0`, so they are always there unless the server strips the field.

import { toStringLiteral } from './identifiers.js'
import type { FieldMeta } from './meta.js'

/** Whether the column can hold `NULL`, or is stored `NOT NULL DEFAULT 0`. */
type Nullability = 'nullable' | 'notNull'

interface ValueType {
    type: string
    nullability: Nullability
    /** What the type alone does not say, such as a date's format. */
    note?: string
}

const nullableString: ValueType = { type: 'string', nullability: 'nullable' }
const notNullNumber: ValueType = { type: 'number', nullability: 'notNull' }

/** The fieldtypes that hold a value, except `Select` (its type comes from its options) and tables. */
const valueTypes: ReadonlyMap<string, ValueType> = new Map([
    ...[
        'Data',
        'Small Text',
        'Text',
        'Long Text',
        'Text Editor',
        'HTML Editor',
        'Markdown Editor',
        'Code',
        'Read Only',
        'Phone',
        'Autocomplete',
        'Color',
        'Barcode',
        'Icon',
        'Signature',
        'Attach',
        'Attach Image',
        'Link',
        'Dynamic Link',
        // GeoJSON, stored as text.
        'Geolocation',
    ].map((fieldtype): [string, ValueType] => [fieldtype, nullableString]),
    ['Password', { ...nullableString, note: 'holds `*` placeholders; read the value with `frappe.doc.getPassword`' }],
    ['Date', { ...nullableString, note: '`YYYY-MM-DD`' }],
    ['Datetime', { ...nullableString, note: '`YYYY-MM-DD HH:mm:ss[.ffffff]`, site timezone' }],
    ['Time', { ...nullableString, note: '`HH:mm:ss[.ffffff]`, site timezone' }],
    ['Int', notNullNumber],
    ['Float', notNullNumber],
    ['Currency', notNullNumber],
    ['Percent', notNullNumber],
    ['Check', { type: '0 | 1', nullability: 'notNull' }],
    ['Long Int', { type: 'number', nullability: 'nullable', note: 'exact up to `Number.MAX_SAFE_INTEGER`' }],
    ['Rating', { type: 'number', nullability: 'nullable' }],
    ['Duration', { type: 'number', nullability: 'nullable', note: 'seconds' }],
    // Documents hold JSON text, but PostgreSQL returns the column parsed in list rows.
    ['JSON', { type: 'unknown', nullability: 'nullable' }],
])

/** Fieldtypes whose rows are documents of a child DocType, named in `options`: Frappe's `table_fields`. */
export const tableFieldtypes: ReadonlySet<string> = new Set(['Table', 'Table MultiSelect'])

/** Fieldtypes that only shape the form and hold no value. */
const layoutFieldtypes: ReadonlySet<string> = new Set([
    'Section Break',
    'Column Break',
    'Tab Break',
    'Attachment Gallery',
    'HTML',
    'Button',
    'Image',
    'Fold',
    'Heading',
])

/** Every fieldtype the mapping knows. */
export const knownFieldtypes: readonly string[] = [
    ...valueTypes.keys(),
    'Select',
    ...tableFieldtypes,
    ...layoutFieldtypes,
]

/** One field as the generated interface declares it. */
export interface MappedField {
    /** The TypeScript type, without `| null`. */
    type: string
    /** The key can be missing. */
    optional: boolean
    /** The value can be `null`. */
    nullable: boolean
    /** The first line of the field's TSDoc: label, fieldtype and notes. */
    summary: string
    /** A problem the caller should hear about, such as an unknown fieldtype. */
    warning?: string
}

/**
 * The union of a Select's option lines, `''` first, or `string` when it has none to choose from. Frappe
 * validates a Select only when it has a value, so one that is not mandatory can be saved as `''`.
 */
function toSelectType({ options, reqd }: FieldMeta): string {
    const lines = (options ?? '').split('\n')
    if (!lines.some((line) => line !== '')) return 'string'
    const values = new Set([...(reqd && !lines.includes('') ? [] : ['']), ...lines])
    return [...values].map(toStringLiteral).join(' | ')
}

/** A masked field holds a placeholder string for users without the mask permission. */
function toMaskedType(type: string, fieldtype: string): string {
    if (fieldtype === 'Select') return 'string'
    return type === 'string' || type === 'unknown' ? type : `${type} | string`
}

/** The fieldtype as the TSDoc shows it: with its target, child, DocType field or Data option. */
function describeFieldtype({ fieldtype, options }: FieldMeta): string {
    if (options === undefined || fieldtype === 'Select') return fieldtype
    if (fieldtype === 'Link' || tableFieldtypes.has(fieldtype)) return `${fieldtype} → ${options}`
    if (fieldtype === 'Dynamic Link') return `${fieldtype}, DocType in \`${options}\``
    return fieldtype === 'Data' ? `${fieldtype}, ${options}` : fieldtype
}

function toSummary(field: FieldMeta, notes: readonly string[]): string {
    const kind = describeFieldtype(field)
    const title = field.label === undefined ? kind : `${field.label} (${kind})`
    return notes.length === 0 ? title : `${title} — ${notes.join('; ')}`
}

/**
 * Maps one field. A layout field (section break, HTML, button, …) holds no value and gives
 * `undefined`. `typeNames` maps each generated DocType to its interface name, for child tables.
 */
export function mapField(
    doctype: string,
    field: FieldMeta,
    typeNames: ReadonlyMap<string, string>,
): MappedField | undefined {
    const { fieldtype } = field
    if (layoutFieldtypes.has(fieldtype)) return undefined
    const where = `DocType '${doctype}', field '${field.fieldname}'`

    if (tableFieldtypes.has(fieldtype)) {
        // `as_dict` always sends a table, `[]` when empty, even when the user may not read its level.
        const childTypeName = typeNames.get(field.options ?? '')
        return {
            type: `${childTypeName ?? 'UnknownDoc'}[]`,
            optional: false,
            nullable: false,
            summary: toSummary(field, []),
            ...(childTypeName === undefined
                ? {
                      warning: `${where}: the child DocType '${field.options ?? ''}' is not generated, so its rows are typed UnknownDoc.`,
                  }
                : {}),
        }
    }

    const valueType =
        fieldtype === 'Select' ? { ...nullableString, type: toSelectType(field) } : valueTypes.get(fieldtype)
    if (valueType === undefined) {
        return {
            type: 'unknown',
            optional: true,
            nullable: false,
            summary: toSummary(field, ['unknown fieldtype']),
            warning: `${where}: the fieldtype '${fieldtype}' is unknown, so its value is typed unknown.`,
        }
    }

    // The server strips a field the user may not read, and a virtual field is not a column.
    const mayBeMissing = field.permlevel > 0 || field.is_virtual
    const optional = valueType.nullability === 'notNull' ? mayBeMissing : mayBeMissing || !field.reqd
    const type = field.mask ? toMaskedType(valueType.type, fieldtype) : valueType.type
    const notes = [
        ...(valueType.note === undefined ? [] : [valueType.note]),
        ...(field.mask ? ['a placeholder such as `XXXXXXXX` for users without the mask permission'] : []),
        ...(field.permlevel > 0 ? [`permission level ${String(field.permlevel)}`] : []),
        ...(field.is_virtual ? ['virtual: computed by the server'] : []),
    ]
    return {
        type,
        optional,
        nullable: valueType.nullability === 'nullable' && optional && type !== 'unknown',
        summary: toSummary(field, notes),
    }
}
