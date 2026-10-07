import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { toPropertyKey, toStringLiteral, toTypeName, toTypeNames } from '../src/identifiers.js'

const docTypes = (...names: string[]): { name: string }[] => names.map((name) => ({ name }))
const typeNamesOf = (...args: Parameters<typeof toTypeNames>): string[] =>
    toTypeNames(...args).map(([, typeName]) => typeName)

describe('toTypeName', () => {
    it.each([
        ['ToDo', 'ToDo'],
        ['Sales Order Item', 'SalesOrderItem'],
        ['POS Invoice', 'POSInvoice'],
        ['GL Entry', 'GLEntry'],
        ['BOM', 'BOM'],
        ['FF Kitchen Sink', 'FFKitchenSink'],
        ['Item Variant_Setting', 'ItemVariant_Setting'],
        ['Item 2 Variant', 'Item2Variant'],
        ['e-Waybill Log', 'EWaybillLog'],
        ['A', 'A'],
    ])("%s → %s, Frappe's class name for it with a capital first letter", (doctype, typeName) => {
        expect(toTypeName(doctype)).toBe(typeName)
    })
})

describe('toTypeNames', () => {
    it('pairs each DocType with its name, in the given order', () => {
        const sales = { name: 'Sales Order' }
        const todo = { name: 'ToDo' }

        expect(toTypeNames([sales, todo])).toStrictEqual([
            [sales, 'SalesOrder'],
            [todo, 'ToDo'],
        ])
    })

    it('takes a name from rename over the derived one', () => {
        expect(typeNamesOf(docTypes('Item', 'ToDo'), { Item: 'ErpItem' })).toStrictEqual(['ErpItem', 'ToDo'])
    })

    it('ignores rename entries for other DocTypes, and never reads inherited properties', () => {
        expect(typeNamesOf(docTypes('constructor', 'ToDo'), { Item: 'ErpItem' })).toStrictEqual(['Constructor', 'ToDo'])
    })

    it('rejects a name that is not an interface name, showing the rename fix', () => {
        expect(() => toTypeNames(docTypes('Item'), { Item: 'class' })).toThrow(
            new Error(
                "DocType 'Item' cannot be named 'class': an interface name starts with an upper-case letter and contains only letters, digits and underscores. Choose another with `rename`: { 'Item': 'MyName' }.",
            ),
        )
        expect(() => toTypeNames(docTypes('2FA Settings'))).toThrow("cannot be named '2FASettings'")
        expect(() => toTypeNames(docTypes('Item'), { Item: 'Erp-Item' })).toThrow("cannot be named 'Erp-Item'")
    })

    it.each(['DocTypes', 'FrappeDoc', 'UnknownDoc'])('rejects %s, which the generated module uses', (reserved) => {
        expect(() => toTypeNames(docTypes('Item'), { Item: reserved })).toThrow(
            new Error(
                `DocType 'Item' cannot be named ${reserved}: the generated module uses that name. Choose another with \`rename\`: { 'Item': 'MyName' }.`,
            ),
        )
    })

    it('rejects a derived name that the module uses', () => {
        expect(() => toTypeNames(docTypes('Doc Types'))).toThrow("DocType 'Doc Types' cannot be named DocTypes")
    })

    it('rejects two DocTypes with one name, naming both', () => {
        expect(() => toTypeNames(docTypes('GL Entry', 'GL-Entry'))).toThrow(
            new Error(
                "DocTypes 'GL Entry' and 'GL-Entry' would both be named GLEntry. Give one of them another name with `rename`: { 'GL-Entry': 'MyName' }.",
            ),
        )
        expect(() => toTypeNames(docTypes('Item', 'Sales Item'), { 'Sales Item': 'Item' })).toThrow(
            "DocTypes 'Item' and 'Sales Item' would both be named Item.",
        )
    })
})

describe('toStringLiteral', () => {
    it.each([
        ['Open', "'Open'"],
        ['', "''"],
        ["Won't Fix", "'Won\\'t Fix'"],
        ['C:\\files', "'C:\\\\files'"],
        ['a\tb\rc\u0000d\u007fe', "'a\\u0009b\\u000dc\\u0000d\\u007fe'"],
        ['line\u2028para\u2029end', "'line\\u2028para\\u2029end'"],
        ['caf\u00e9 \u{1F600}', "'caf\u00e9 \u{1F600}'"],
    ])('%j → %s', (value, literal) => {
        expect(toStringLiteral(value)).toBe(literal)
    })

    it('evaluates back to the same string', () => {
        const value = `'\\\u2028\u0001"\`\${x}\``

        expect(runInNewContext(toStringLiteral(value))).toBe(value)
    })
})

describe('toPropertyKey', () => {
    it.each([
        ['customer', 'customer'],
        ['_user_tags', '_user_tags'],
        ['default', 'default'],
        ['class', 'class'],
        ['\u0627\u0644\u0627\u0633\u0645', '\u0627\u0644\u0627\u0633\u0645'],
        ['1st_value', "'1st_value'"],
        ['delivery-date', "'delivery-date'"],
        ['grand total', "'grand total'"],
    ])('%s → %s', (fieldname, key) => {
        expect(toPropertyKey(fieldname)).toBe(key)
    })
})
