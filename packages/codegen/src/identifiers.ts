// Identifiers in the generated module: an interface name per DocType, property keys, and the string
// literals that quote what cannot be an identifier.

/** Names the generated module declares or imports itself, so no DocType may take them. */
const reservedTypeNames: ReadonlySet<string> = new Set(['DocTypes', 'FrappeDoc', 'UnknownDoc'])

/**
 * A usable interface name: an identifier that starts with an upper-case letter. That rules out every
 * reserved word and built-in type name (`string`, `class`, …), which are all lower-case.
 */
const capitalizedIdentifier = /^\p{Lu}\p{ID_Continue}*$/u

/** An identifier, which a property key can be without quotes (reserved words included). */
const identifier = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u

/** Characters a single-quoted string literal cannot hold as they are. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what must be escaped
const unsafeInString = /[\\'\u0000-\u001f\u007f\u2028\u2029]/gu

/**
 * The interface name derived from a DocType name: the class name Frappe gives the DocType's controller
 * (spaces and `-` removed, as `doctype.replace(" ", "").replace("-", "")`), with its first letter
 * upper-cased — `Sales Order Item` → `SalesOrderItem`, `POS Invoice` → `POSInvoice`, `ToDo` → `ToDo`,
 * `e-Waybill Log` → `EWaybillLog`.
 */
export function toTypeName(doctype: string): string {
    const className = doctype.replaceAll(' ', '').replaceAll('-', '')
    return className.charAt(0).toUpperCase() + className.slice(1)
}

/**
 * Pairs each DocType with its interface name: from `rename` when it names the DocType, derived
 * otherwise. Throws when a name is not usable, is one the module declares itself, or is shared by two
 * DocTypes; the message names the DocTypes and shows the `rename` fix.
 */
export function toTypeNames<T extends { readonly name: string }>(
    docTypes: readonly T[],
    rename: Readonly<Record<string, string>> = {},
): (readonly [meta: T, typeName: string])[] {
    const doctypeByTypeName = new Map<string, string>()
    return docTypes.map((meta) => {
        const doctype = meta.name
        const typeName = (Object.hasOwn(rename, doctype) ? rename[doctype] : undefined) ?? toTypeName(doctype)
        const hint = `Choose another with \`rename\`: { '${doctype}': 'MyName' }.`
        if (!capitalizedIdentifier.test(typeName)) {
            throw new Error(
                `DocType '${doctype}' cannot be named '${typeName}': an interface name starts with an upper-case letter and contains only letters, digits and underscores. ${hint}`,
            )
        }
        if (reservedTypeNames.has(typeName)) {
            throw new Error(
                `DocType '${doctype}' cannot be named ${typeName}: the generated module uses that name. ${hint}`,
            )
        }
        const other = doctypeByTypeName.get(typeName)
        if (other !== undefined) {
            throw new Error(
                `DocTypes '${other}' and '${doctype}' would both be named ${typeName}. Give one of them another name with \`rename\`: { '${doctype}': 'MyName' }.`,
            )
        }
        doctypeByTypeName.set(typeName, doctype)
        return [meta, typeName] as const
    })
}

/** A single-quoted string literal holding `value` exactly. */
export function toStringLiteral(value: string): string {
    const escaped = value.replace(unsafeInString, (char) => {
        if (char === '\\') return '\\\\'
        if (char === "'") return "\\'"
        return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
    })
    return `'${escaped}'`
}

/** A property key: the field name as it is when it is an identifier, quoted otherwise. */
export function toPropertyKey(fieldname: string): string {
    return identifier.test(fieldname) ? fieldname : toStringLiteral(fieldname)
}
