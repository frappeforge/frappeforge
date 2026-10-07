import { describe, expect, it } from 'vitest'

import { knownFieldtypes, mapField } from '../src/mapping.js'
import type { FieldMeta } from '../src/meta.js'

const typeNames = new Map([['FF Kitchen Sink Item', 'FFKitchenSinkItem']])

function field(fieldtype: string, overrides: Partial<FieldMeta> = {}): FieldMeta {
    return { fieldname: 'value', fieldtype, reqd: false, permlevel: 0, is_virtual: false, mask: false, ...overrides }
}

function map(meta: FieldMeta): ReturnType<typeof mapField> {
    return mapField('FF Kitchen Sink', meta, typeNames)
}

/** The declaration the generated interface gets: `?:`, the type and `| null`. */
function declaration(meta: FieldMeta): string | undefined {
    const mapped = map(meta)
    return mapped && `${mapped.optional ? '?: ' : ': '}${mapped.type}${mapped.nullable ? ' | null' : ''}`
}

const textFieldtypes = [
    'Data',
    'Small Text',
    'Text',
    'Long Text',
    'Text Editor',
    'HTML Editor',
    'Markdown Editor',
    'Code',
    'Read Only',
    'Password',
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
    'Geolocation',
]
const layoutFieldtypes = [
    'Section Break',
    'Column Break',
    'Tab Break',
    'Attachment Gallery',
    'HTML',
    'Button',
    'Image',
    'Fold',
    'Heading',
]

describe('mapField', () => {
    describe('nullable columns: present when mandatory, otherwise missing from documents and null in lists', () => {
        it.each([...textFieldtypes, 'Date', 'Datetime', 'Time'])('%s is a string', (fieldtype) => {
            expect(declaration(field(fieldtype))).toBe('?: string | null')
            expect(declaration(field(fieldtype, { reqd: true }))).toBe(': string')
        })

        it.each(['Long Int', 'Rating', 'Duration'])('%s is a number that can be null', (fieldtype) => {
            expect(declaration(field(fieldtype))).toBe('?: number | null')
            expect(declaration(field(fieldtype, { reqd: true }))).toBe(': number')
        })

        it('JSON is unknown, which already includes null', () => {
            expect(declaration(field('JSON'))).toBe('?: unknown')
            expect(declaration(field('JSON', { reqd: true }))).toBe(': unknown')
        })

        it.each([
            ['a permission level above 0', { permlevel: 1 }],
            ['a virtual field', { is_virtual: true }],
        ])('a mandatory field can still be missing with %s', (_case, overrides) => {
            expect(declaration(field('Data', { reqd: true, ...overrides }))).toBe('?: string | null')
        })
    })

    describe('NOT NULL DEFAULT 0 columns: always present unless the server strips the field', () => {
        it.each(['Int', 'Float', 'Currency', 'Percent'])('%s is a number', (fieldtype) => {
            expect(declaration(field(fieldtype))).toBe(': number')
        })

        it('Check is 0 or 1', () => {
            expect(declaration(field('Check'))).toBe(': 0 | 1')
        })

        it.each([
            ['a permission level above 0', { permlevel: 1 }],
            ['a virtual field', { is_virtual: true }],
        ])('is optional, never null, with %s', (_case, overrides) => {
            expect(declaration(field('Int', overrides))).toBe('?: number')
            expect(declaration(field('Check', overrides))).toBe('?: 0 | 1')
        })
    })

    describe('Select', () => {
        // Frappe validates a Select only when it has a value, so a field that is not mandatory can be
        // saved as '' even when no option line is blank.
        it.each([
            ["the option lines as a union, with ''", 'Open\nClosed', "?: '' | 'Open' | 'Closed' | null"],
            ["'' once when a blank line exists", '\nOpen\nClosed', "?: '' | 'Open' | 'Closed' | null"],
            ["'' first, wherever the blank line is", 'Open\n\nClosed', "?: '' | 'Open' | 'Closed' | null"],
            ['each option once', 'Open\nClosed\nOpen', "?: '' | 'Open' | 'Closed' | null"],
            ['escaped quotes', "Done\nWon't Fix", "?: '' | 'Done' | 'Won\\'t Fix' | null"],
            ['string with no options', undefined, '?: string | null'],
            ['string with blank lines only', '\n\n', '?: string | null'],
        ])('is %s', (_case, options, expected) => {
            expect(declaration(field('Select', options === undefined ? {} : { options }))).toBe(expected)
        })

        it("is required, without '', when mandatory", () => {
            expect(declaration(field('Select', { options: 'Goods\nServices', reqd: true }))).toBe(
                ": 'Goods' | 'Services'",
            )
        })

        it("keeps '' from a blank line when mandatory", () => {
            expect(declaration(field('Select', { options: '\nGoods\nServices', reqd: true }))).toBe(
                ": '' | 'Goods' | 'Services'",
            )
        })
    })

    describe('masked fields also hold a placeholder string', () => {
        it.each([
            ['Select', { options: 'Draft\nReview' }, '?: string | null'],
            ['Int', {}, ': number | string'],
            ['Duration', {}, '?: number | string | null'],
            ['Check', {}, ': 0 | 1 | string'],
            ['Data', {}, '?: string | null'],
            ['Date', {}, '?: string | null'],
            ['JSON', {}, '?: unknown'],
        ])('%s', (fieldtype, overrides, expected) => {
            expect(declaration(field(fieldtype, { mask: true, ...overrides }))).toBe(expected)
        })
    })

    describe('tables', () => {
        it.each(['Table', 'Table MultiSelect'])('%s is an array of child rows, always present', (fieldtype) => {
            expect(map(field(fieldtype, { options: 'FF Kitchen Sink Item', permlevel: 1, reqd: false }))).toStrictEqual(
                {
                    type: 'FFKitchenSinkItem[]',
                    optional: false,
                    nullable: false,
                    summary: `${fieldtype} → FF Kitchen Sink Item`,
                },
            )
        })

        it('types the rows of a child that is not generated as UnknownDoc, with a warning', () => {
            expect(map(field('Table', { fieldname: 'external_items', options: 'FF External Item' }))).toStrictEqual({
                type: 'UnknownDoc[]',
                optional: false,
                nullable: false,
                summary: 'Table → FF External Item',
                warning:
                    "DocType 'FF Kitchen Sink', field 'external_items': the child DocType 'FF External Item' is not generated, so its rows are typed UnknownDoc.",
            })
        })

        it('treats a table without a child DocType the same way', () => {
            expect(map(field('Table'))?.warning).toBe(
                "DocType 'FF Kitchen Sink', field 'value': the child DocType '' is not generated, so its rows are typed UnknownDoc.",
            )
        })
    })

    it.each(layoutFieldtypes)('omits %s, which holds no value', (fieldtype) => {
        expect(map(field(fieldtype, { options: 'image' }))).toBeUndefined()
    })

    it('types an unknown fieldtype as unknown, always optional, with a warning', () => {
        expect(
            map(field('Future Type', { fieldname: 'future_value', label: 'Future Value', reqd: true })),
        ).toStrictEqual({
            type: 'unknown',
            optional: true,
            nullable: false,
            summary: 'Future Value (Future Type) — unknown fieldtype',
            warning:
                "DocType 'FF Kitchen Sink', field 'future_value': the fieldtype 'Future Type' is unknown, so its value is typed unknown.",
        })
    })

    it('never reads an inherited property as a fieldtype', () => {
        expect(map(field('constructor'))?.type).toBe('unknown')
    })

    describe('summary, the first line of the TSDoc', () => {
        it.each([
            [field('Data', { label: 'Title' }), 'Title (Data)'],
            [field('Data'), 'Data'],
            [field('Data', { label: 'Email', options: 'Email' }), 'Email (Data, Email)'],
            [field('Link', { label: 'Assigned To', options: 'User' }), 'Assigned To (Link → User)'],
            [field('Link'), 'Link'],
            [
                field('Dynamic Link', { label: 'Reference Name', options: 'reference_type' }),
                'Reference Name (Dynamic Link, DocType in `reference_type`)',
            ],
            [field('Select', { label: 'Status', options: 'Open\nClosed' }), 'Status (Select)'],
            [field('Code', { options: 'Python' }), 'Code'],
            [field('Date'), 'Date — `YYYY-MM-DD`'],
            [field('Datetime'), 'Datetime — `YYYY-MM-DD HH:mm:ss[.ffffff]`, site timezone'],
            [field('Time'), 'Time — `HH:mm:ss[.ffffff]`, site timezone'],
            [field('Long Int'), 'Long Int — exact up to `Number.MAX_SAFE_INTEGER`'],
            [field('Duration'), 'Duration — seconds'],
            [field('Password'), 'Password — holds `*` placeholders; read the value with `frappe.doc.getPassword`'],
            [field('Currency', { label: 'Cost', permlevel: 1 }), 'Cost (Currency) — permission level 1'],
            [field('Float', { is_virtual: true }), 'Float — virtual: computed by the server'],
            [
                field('Percent', { mask: true, permlevel: 2, is_virtual: true }),
                'Percent — a placeholder such as `XXXXXXXX` for users without the mask permission; permission level 2; virtual: computed by the server',
            ],
        ])('%j → %s', (meta, summary) => {
            expect(map(meta)?.summary).toBe(summary)
        })
    })
})

describe('knownFieldtypes', () => {
    it('lists every fieldtype of the mapping once', () => {
        expect([...knownFieldtypes].sort()).toStrictEqual(
            [
                ...textFieldtypes,
                'Date',
                'Datetime',
                'Time',
                'Select',
                'Int',
                'Float',
                'Currency',
                'Percent',
                'Check',
                'Long Int',
                'Rating',
                'Duration',
                'JSON',
                'Table',
                'Table MultiSelect',
                ...layoutFieldtypes,
            ].sort(),
        )
    })
})
