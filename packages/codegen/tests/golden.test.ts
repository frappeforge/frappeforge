import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { generate, type GenerateOptions } from '../src/generate.js'
import { knownFieldtypes } from '../src/mapping.js'
import { type DocTypeMeta, normalizeDocType } from '../src/meta.js'

/**
 * Every DocType in a fixture folder. Each file holds the `docs` of one `getdoctype` answer: the
 * DocType and its child tables. A child shared by two answers is read once.
 */
function loadFixtures(folder: string): DocTypeMeta[] {
    const dir = new URL(`fixtures/meta/${folder}/`, import.meta.url)
    const byName = new Map<string, DocTypeMeta>()
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
        const { docs } = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as { docs: unknown[] }
        for (const meta of docs.map(normalizeDocType)) {
            if (!byName.has(meta.name)) byName.set(meta.name, meta)
        }
    }
    return [...byName.values()]
}

/** Text from metadata that must not break the generated module: comment ends, quotes, line breaks. */
const escapingDocTypes = [
    {
        name: 'FF Escaping',
        module: 'Custom',
        description: 'Text that would end a comment early: */ — and a line\u2028separator.',
        fields: [
            { fieldname: '1st_value', fieldtype: 'Data', label: 'First */ value' },
            { fieldname: 'delivery-date', fieldtype: 'Date', label: 'Delivery Date', reqd: 1 },
            { fieldname: 'path', fieldtype: 'Select', label: 'Path', options: "C:\\files\nit's\nline\u2028separator" },
            { fieldname: 'remarks', fieldtype: 'Small Text', label: 'Remarks', description: 'Line one\n\nLine two */' },
        ],
    },
    {
        // Fields named like standard ones, as core DocTypes have: `Custom DocPerm.parent`, `Web Page.idx`.
        name: 'FF Standard Names',
        module: 'Custom',
        fields: [
            { fieldname: 'parent', fieldtype: 'Link', label: 'Reference Document Type', options: 'DocType' },
            { fieldname: 'idx', fieldtype: 'Int', label: 'Index' },
            { fieldname: '_user_tags', fieldtype: 'Data', label: 'Tags' },
            { fieldname: 'owner', fieldtype: 'Data', label: 'Owner' },
            // The rest of `FrappeDoc`'s fields, so that the type check covers every declaration.
            ...['creation', 'modified', 'modified_by', 'parentfield', 'parenttype'].map((fieldname) => ({
                fieldname,
                fieldtype: 'Data',
            })),
            { fieldname: 'docstatus', fieldtype: 'Int' },
            ...['_comments', '_assign', '_liked_by'].map((fieldname) => ({ fieldname, fieldtype: 'Small Text' })),
        ],
    },
    {
        name: 'FF Standard Names Item',
        module: 'Custom',
        istable: 1,
        fields: [
            { fieldname: 'parent', fieldtype: 'Data', label: 'Parent' },
            { fieldname: 'item', fieldtype: 'Data', label: 'Item' },
        ],
    },
    {
        name: 'FF Settings',
        module: 'Custom',
        issingle: 1,
        autoname: 'autoincrement',
        fields: [{ fieldname: 'enabled', fieldtype: 'Check', label: 'Enabled' }],
    },
].map(normalizeDocType)

const goldens: readonly { file: string; docTypes: DocTypeMeta[]; options: GenerateOptions; warnings: string[] }[] = [
    {
        file: 'ff.generated.ts',
        docTypes: loadFixtures('ff'),
        options: {},
        warnings: [
            "DocType 'FF Kitchen Sink', field 'future_value': the fieldtype 'Future Type' is unknown, so its value is typed unknown.",
            "DocType 'FF Kitchen Sink', field 'external_items': the child DocType 'FF External Item' is not generated, so its rows are typed UnknownDoc.",
        ],
    },
    { file: 'v15.generated.ts', docTypes: loadFixtures('v15'), options: { register: false }, warnings: [] },
    { file: 'v16.generated.ts', docTypes: loadFixtures('v16'), options: { register: false }, warnings: [] },
    {
        file: 'escaping.generated.ts',
        docTypes: escapingDocTypes,
        options: { register: false, rename: { 'FF Settings': 'ForgeSettings' } },
        warnings: [],
    },
]

describe.each(goldens)('$file', ({ file, docTypes, options, warnings }) => {
    it('matches the golden file', async () => {
        const result = generate(docTypes, options)

        expect(result.warnings).toStrictEqual(warnings)
        await expect(result.code).toMatchFileSnapshot(`golden/${file}`)
    })

    it('is the same, byte for byte, whatever the order of the DocTypes', () => {
        const expected = generate(docTypes, options).code
        const rotated = [...docTypes.slice(1), ...docTypes.slice(0, 1)]

        expect(generate([...docTypes].reverse(), options).code).toBe(expected)
        expect(generate(rotated, options).code).toBe(expected)
    })
})

describe('the FF Kitchen Sink fixture', () => {
    it('has a field of every fieldtype the mapping knows, and one it does not', () => {
        const kitchenSink = loadFixtures('ff').find(({ name }) => name === 'FF Kitchen Sink')
        const fieldtypes = new Set(kitchenSink?.fields.map(({ fieldtype }) => fieldtype))

        expect([...fieldtypes].sort()).toStrictEqual([...knownFieldtypes, 'Future Type'].sort())
    })
})
