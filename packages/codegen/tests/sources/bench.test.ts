import { chmod } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { generate } from '../../src/generate.js'
import { normalizeDocType } from '../../src/meta.js'
import { findParentBench, loadFromBench } from '../../src/sources/bench.js'
import { recordedBundles } from '../support/site.js'
import { tempDir } from '../support/temp-dir.js'

type JSONObject = Record<string, unknown>

/** Frappe's `scrub`, for the paths of the files below. */
function scrub(name: string): string {
    return name.replaceAll(' ', '_').replaceAll('-', '_').toLowerCase()
}

/** A Data field, or one of `fieldtype`. */
function field(fieldname: string, fieldtype = 'Data', extra: JSONObject = {}): JSONObject {
    return { fieldname, fieldtype, ...extra }
}

/** A DocType record as an app stores it. */
function docType(name: string, module: string, fields: readonly JSONObject[], extra: JSONObject = {}): JSONObject {
    return { doctype: 'DocType', name, module, fields, ...extra }
}

/**
 * The files of an app on a bench: its `modules.txt` (the DocTypes' modules, unless given), a JSON file
 * for each DocType, and `extra` files by their path in the Python package: JSON values, or text as it is.
 */
function appFiles(
    app: string,
    docTypes: readonly JSONObject[],
    extra: Readonly<Record<string, unknown>> = {},
): Record<string, string> {
    const packageDir = `apps/${app}/${app}`
    const modules = [...new Set(docTypes.map((record) => String(record['module'])))]
    const files: Record<string, string> = { [`${packageDir}/modules.txt`]: `${modules.join('\n')}\n` }
    for (const record of docTypes) {
        const name = scrub(String(record['name']))
        files[`${packageDir}/${scrub(String(record['module']))}/doctype/${name}/${name}.json`] = JSON.stringify(record)
    }
    for (const [relativePath, value] of Object.entries(extra)) {
        files[`${packageDir}/${relativePath}`] = typeof value === 'string' ? value : JSON.stringify(value)
    }
    return files
}

/** A custom field row, as Frappe exports it. */
function customField(dt: string, fieldname: string, extra: JSONObject = {}): JSONObject {
    return { doctype: 'Custom Field', dt, fieldname, fieldtype: 'Data', ...extra }
}

/** A property setter row, as Frappe exports it. */
function propertySetter(docType: string, property: string, value: string, extra: JSONObject = {}): JSONObject {
    return {
        doctype: 'Property Setter',
        doc_type: docType,
        doctype_or_field: 'DocField',
        property,
        property_type: 'Data',
        value,
        ...extra,
    }
}

/** The field names of one DocType read from a bench. */
async function fieldnamesOf(benchDir: string, doctype: string): Promise<string[]> {
    const [meta] = await loadFromBench(benchDir, { doctypes: [doctype] })
    return meta?.fields.map(({ fieldname }) => fieldname) ?? []
}

/**
 * A bench whose app `ff_app` holds `FF Note` with `fields`, and the export `custom/ff_note.json`, with
 * `files` by their path on the bench.
 */
function noteBench(
    fields: readonly JSONObject[],
    custom: JSONObject,
    files: Readonly<Record<string, string>> = {},
): Promise<string> {
    return tempDir({
        ...appFiles('ff_app', [docType('FF Note', 'FF Module', fields)], {
            'ff_module/custom/ff_note.json': { doctype: 'FF Note', sync_on_migrate: 1, ...custom },
        }),
        ...files,
    })
}

describe('findParentBench', () => {
    it('finds the bench from itself and from a directory inside it', async () => {
        const bench = await tempDir(appFiles('frappe', []))

        await expect(findParentBench(bench)).resolves.toBe(bench)
        await expect(findParentBench(path.join(bench, 'apps/frappe/frontend/src'))).resolves.toBe(bench)
    })

    it('passes over an apps folder that holds no Frappe app, such as a JavaScript monorepo', async () => {
        const bench = await tempDir({
            ...appFiles('ff_app', []),
            'apps/ff_app/frontend/apps/web/package.json': '{}',
        })

        await expect(findParentBench(path.join(bench, 'apps/ff_app/frontend/apps/web'))).resolves.toBe(bench)
    })

    it('finds nothing outside a bench', async () => {
        const dir = await tempDir({ 'apps/web/package.json': '{}' })

        await expect(findParentBench(dir)).resolves.toBeUndefined()
    })

    it.runIf(process.getuid?.() !== 0)('passes over an apps folder it may not read, as bench does', async () => {
        const dir = await tempDir({ 'apps/private/package.json': '{}', 'project/package.json': '{}' })
        await chmod(path.join(dir, 'apps'), 0)

        try {
            await expect(findParentBench(path.join(dir, 'project'))).resolves.toBeUndefined()
        } finally {
            await chmod(path.join(dir, 'apps'), 0o755)
        }
    })
})

describe('loadFromBench', () => {
    describe('the apps', () => {
        it('fails without an app', async () => {
            const dir = await tempDir({ 'apps/web/package.json': '{}' })

            await expect(loadFromBench(dir, { apps: ['web'] })).rejects.toThrow(
                new Error(`${dir} has no Frappe app in apps/.`),
            )
        })

        it('lists frappe first, then the other apps by name', async () => {
            const bench = await tempDir({
                ...appFiles('erpnext', []),
                ...appFiles('frappe', []),
                ...appFiles('ff_app', []),
            })

            await expect(loadFromBench(bench, { apps: ['hrms'] })).rejects.toThrow(
                new Error("App 'hrms' is not on the bench, which has frappe, erpnext, ff_app: check its name."),
            )
        })
    })

    describe('the DocType files', () => {
        it("reads modules.txt as Frappe does, and each module's directory under its scrubbed name", async () => {
            const bench = await tempDir({
                ...appFiles('ff_app', [
                    docType('FF Note', 'Desk', []),
                    docType('FF Hook', 'ERPNext Integrations', []),
                    docType('FF Batch', 'Bulk-Transaction', []),
                    docType('FF Unlisted', 'Unlisted', []),
                ]),
                'apps/ff_app/ff_app/modules.txt':
                    '  Desk  \r\n\n# ERPNext Integrations\nERPNext Integrations\nBulk-Transaction\nNo Directory\n',
            })

            const docTypes = await loadFromBench(bench, { apps: ['ff_app'] })

            expect(docTypes.map(({ name }) => name)).toStrictEqual(['FF Note', 'FF Hook', 'FF Batch'])
        })

        it('lists the DocTypes of a module by their directory names, whatever the file system order', async () => {
            const bench = await tempDir(
                appFiles(
                    'ff_app',
                    ['FF E', 'FF C', 'FF A', 'FF D', 'FF B'].map((name) => docType(name, 'FF Module', [])),
                ),
            )

            const docTypes = await loadFromBench(bench, { apps: ['ff_app'] })

            expect(docTypes.map(({ name }) => name)).toStrictEqual(['FF A', 'FF B', 'FF C', 'FF D', 'FF E'])
        })

        it('keeps the naming rule, so that an autoincrement DocType is named by a number', async () => {
            const bench = await tempDir(
                appFiles('ff_app', [docType('FF Counter', 'FF Module', [], { autoname: 'autoincrement' })]),
            )

            const { code } = generate(await loadFromBench(bench, { doctypes: ['FF Counter'] }))

            expect(code).toContain("doctype: 'FF Counter'\n    name: number\n")
        })

        it('reads only <name>/<name>.json files that hold a DocType', async () => {
            const bench = await tempDir({
                ...appFiles('ff_app', [docType('FF Note', 'FF Module', [field('title')])], {
                    'ff_module/doctype/__init__.py': '',
                    'ff_module/doctype/ff_note/test_records.json': '[]',
                    'ff_module/doctype/ff_empty/__init__.py': '',
                    'ff_module/doctype/ff_report/ff_report.json': JSON.stringify({ doctype: 'Report', name: 'R' }),
                    'ff_module/doctype/ff_list/ff_list.json': '[]',
                }),
            })

            await expect(loadFromBench(bench, { apps: ['ff_app'] })).resolves.toStrictEqual([
                normalizeDocType(docType('FF Note', 'FF Module', [field('title')])),
            ])
        })

        it("orders the fields by the file's field_order, then the fields it does not name", async () => {
            const bench = await tempDir(
                appFiles('ff_app', [
                    docType('FF Note', 'FF Module', [field('a'), field('b'), field('c'), field('d')], {
                        field_order: ['c', 'ghost', 'a'],
                    }),
                ]),
            )

            await expect(fieldnamesOf(bench, 'FF Note')).resolves.toStrictEqual(['c', 'a', 'b', 'd'])
        })

        it('names the file that is not valid JSON', async () => {
            const bench = await tempDir(
                appFiles('ff_app', [], { 'modules.txt': 'FF Module\n', 'ff_module/doctype/ff_bad/ff_bad.json': '{' }),
            )
            const file = path.join(bench, 'apps/ff_app/ff_app/ff_module/doctype/ff_bad/ff_bad.json')

            await expect(loadFromBench(bench, { apps: ['ff_app'] })).rejects.toThrow(`Cannot read ${file}: `)
        })

        it('takes a DocType two apps define from the later app, as bench migrate imports it last', async () => {
            const bench = await tempDir({
                ...appFiles('frappe', [docType('Print Heading', 'Printing', [field('old')])]),
                ...appFiles('erpnext', [docType('Print Heading', 'Setup', [field('print_heading')])]),
            })

            await expect(loadFromBench(bench, { apps: ['erpnext'] })).resolves.toStrictEqual([
                normalizeDocType(docType('Print Heading', 'Setup', [field('print_heading')])),
            ])
            await expect(loadFromBench(bench, { modules: ['Printing'] })).rejects.toThrow(
                /^Module 'Printing' has no DocTypes/u,
            )
        })

        it('rejects a DocType file that is not DocType metadata, only when it is read', async () => {
            const bench = await tempDir({
                ...appFiles('ff_app', [docType('FF Note', 'FF Module', [field('title')])]),
                ...appFiles('ff_old', [docType('FF Old', 'FF Old Module', [{ fieldtype: 'Section Break' }])]),
            })

            await expect(fieldnamesOf(bench, 'FF Note')).resolves.toStrictEqual(['title'])
            await expect(loadFromBench(bench, { apps: ['ff_old'] })).rejects.toThrow(
                new TypeError("DocType 'FF Old', fields[0]: `fieldname` must be a non-empty string."),
            )
        })

        it.runIf(process.getuid?.() !== 0)('fails on a file or directory it may not read', async () => {
            const bench = await tempDir(appFiles('ff_app', [docType('FF Note', 'FF Module', [])]))
            const doctypeDir = path.join(bench, 'apps/ff_app/ff_app/ff_module/doctype')
            const file = path.join(doctypeDir, 'ff_note/ff_note.json')

            await chmod(file, 0)
            await expect(loadFromBench(bench, { apps: ['ff_app'] })).rejects.toThrow(/EACCES/u)
            await chmod(file, 0o644)
            await chmod(doctypeDir, 0)
            await expect(loadFromBench(bench, { apps: ['ff_app'] })).rejects.toThrow(/EACCES/u)
            await chmod(doctypeDir, 0o755)
        })
    })

    describe('custom fields', () => {
        it('go after their insert_after, in idx order, at the top without one, and at the end when it is missing', async () => {
            const bench = await noteBench([field('a'), field('b'), field('c')], {
                custom_fields: [
                    customField('FF Note', 'c1', { insert_after: 'a', idx: 2 }),
                    customField('FF Note', 'c2', { insert_after: 'a', idx: 1 }),
                    customField('FF Note', 'c3', { insert_after: 'ghost', idx: 3 }),
                    customField('FF Note', 'c4', { insert_after: null }),
                    // Placed after c1, which is placed in the same pass, later.
                    customField('FF Note', 'c5', { insert_after: 'c1', idx: 0 }),
                ],
                property_setters: [],
            })

            await expect(fieldnamesOf(bench, 'FF Note')).resolves.toStrictEqual([
                'c4',
                'a',
                'c2',
                'c1',
                'c5',
                'b',
                'c',
                'c3',
            ])
        })

        /** `FF Note` with custom breaks, on a bench with `files`. */
        const breakBench = (files: Readonly<Record<string, string>>): Promise<string> =>
            noteBench(
                [
                    field('s1', 'Section Break'),
                    field('a'),
                    field('cb', 'Column Break'),
                    field('b'),
                    field('s2', 'Section Break'),
                    field('c'),
                ],
                {
                    custom_fields: [
                        customField('FF Note', 'col', { fieldtype: 'Column Break', insert_after: 's1', idx: 1 }),
                        customField('FF Note', 'tab', { fieldtype: 'Tab Break', insert_after: 'a', idx: 2 }),
                        customField('FF Note', 'sec', { fieldtype: 'Section Break', insert_after: 'a', idx: 3 }),
                        customField('FF Note', 'x', { insert_after: 'col', idx: 4 }),
                        customField('FF Note', 'lost', { fieldtype: 'Section Break', insert_after: 'ghost', idx: 5 }),
                    ],
                },
                files,
            )
        const frappeInit = 'apps/frappe/frappe/__init__.py'

        it.each([
            ['on Frappe 16', { [frappeInit]: '__version__ = "16.35.0"\n__title__ = "Frappe Framework"\n' }],
            ['without frappe on the bench', {}],
        ])('put a custom break at the end of the section, column or tab it is placed in, %s', async (_, files) => {
            await expect(fieldnamesOf(await breakBench(files), 'FF Note')).resolves.toStrictEqual([
                's1',
                'a',
                'cb',
                'sec',
                'b',
                'col',
                'x',
                's2',
                'c',
                'tab',
                'lost',
            ])
        })

        it('put a custom break right after its insert_after on Frappe 15', async () => {
            const bench = await breakBench({
                [frappeInit]: '__version__ = "15.121.1"\n__title__ = "Frappe Framework"\n',
            })

            await expect(fieldnamesOf(bench, 'FF Note')).resolves.toStrictEqual([
                's1',
                'col',
                'x',
                'a',
                'tab',
                'sec',
                'cb',
                'b',
                's2',
                'c',
                'lost',
            ])
        })
    })

    describe('the field_order property setter', () => {
        const fieldOrder = (value: string): JSONObject =>
            propertySetter('FF Note', 'field_order', value, { doctype_or_field: 'DocType', field_name: null })

        it('orders every field when it names them all', async () => {
            const bench = await noteBench([field('a'), field('b')], {
                custom_fields: [customField('FF Note', 'c', { insert_after: 'a' })],
                property_setters: [fieldOrder('["c", "b", "a", 1]')],
            })

            await expect(fieldnamesOf(bench, 'FF Note')).resolves.toStrictEqual(['c', 'b', 'a'])
        })

        it('puts a field it does not name after the field before it', async () => {
            const bench = await noteBench([field('a'), field('b'), field('c')], {
                custom_fields: [customField('FF Note', 'd', { insert_after: 'b' })],
                property_setters: [fieldOrder('["b", "a"]')],
            })

            await expect(fieldnamesOf(bench, 'FF Note')).resolves.toStrictEqual(['b', 'c', 'd', 'a'])
        })

        it('puts first the standard fields before the first one it names', async () => {
            const bench = await noteBench([field('a'), field('b'), field('c')], {
                property_setters: [fieldOrder('["c", "b"]')],
            })

            await expect(fieldnamesOf(bench, 'FF Note')).resolves.toStrictEqual(['a', 'c', 'b'])
        })

        it('is dropped when it names no standard field before the custom ones', async () => {
            const bench = await noteBench([field('a')], {
                custom_fields: [customField('FF Note', 'z'), customField('FF Note', 'y', { insert_after: 'a' })],
                property_setters: [fieldOrder('["y"]')],
            })

            await expect(fieldnamesOf(bench, 'FF Note')).resolves.toStrictEqual(['z', 'a', 'y'])
        })

        it('is ignored when empty', async () => {
            const bench = await noteBench([field('a'), field('b')], { property_setters: [fieldOrder('')] })

            await expect(fieldnamesOf(bench, 'FF Note')).resolves.toStrictEqual(['a', 'b'])
        })
    })

    describe('property setters', () => {
        it("set a field's property, converting checks and integers as Frappe's cast does", async () => {
            const bench = await noteBench([field('a'), field('b'), field('c'), field('d'), field('e')], {
                property_setters: [
                    propertySetter('FF Note', 'reqd', '1', { field_name: 'a', property_type: 'Check' }),
                    propertySetter('FF Note', 'permlevel', ' 2 ', { field_name: 'b', property_type: 'Int' }),
                    propertySetter('FF Note', 'is_virtual', 'True', { field_name: 'c', property_type: 'Check' }),
                    propertySetter('FF Note', 'reqd', 'false', { field_name: 'd', property_type: 'Check' }),
                    propertySetter('FF Note', 'mask', 'yes', { field_name: 'd', property_type: 'Check' }),
                    propertySetter('FF Note', 'label', 'Renamed', { field_name: 'e' }),
                    propertySetter('FF Note', 'label', 'Lost', { field_name: 'ghost' }),
                    propertySetter('FF Note', 'description', 'Linked', {
                        doctype_or_field: 'DocType Link',
                        row_name: 'abc123',
                    }),
                ],
            })

            const [meta] = await loadFromBench(bench, { doctypes: ['FF Note'] })

            expect(meta?.fields).toStrictEqual(
                [
                    field('a', 'Data', { reqd: 1 }),
                    field('b', 'Data', { permlevel: 2 }),
                    field('c', 'Data', { is_virtual: 1 }),
                    field('d'),
                    field('e', 'Data', { label: 'Renamed' }),
                ].map((expected) => normalizeDocType(docType('X', 'M', [expected])).fields[0]),
            )
            expect(meta?.description).toBeUndefined()
        })

        it("set the DocType's own properties", async () => {
            const bench = await noteBench([], {
                property_setters: [
                    propertySetter('FF Note', 'autoname', 'autoincrement', { doctype_or_field: 'DocType' }),
                    propertySetter('FF Note', 'description', 'Notes', { doctype_or_field: 'DocType' }),
                ],
            })

            await expect(loadFromBench(bench, { doctypes: ['FF Note'] })).resolves.toMatchObject([
                { autoname: 'autoincrement', description: 'Notes' },
            ])
        })

        it('apply in the order bench migrate syncs them: fixtures, then custom folders, frappe first', async () => {
            const bench = await tempDir({
                ...appFiles('frappe', [docType('FF Note', 'FF Module', [field('a'), field('b')])], {
                    'fixtures/README.md': 'not JSON',
                    'fixtures/custom_field.json': [
                        customField('FF Note', 'c', { label: 'From fixtures' }),
                        1,
                        { doctype: 'Role', role_name: 'Tester' },
                    ],
                    'fixtures/01_property_setter.json': propertySetter('FF Note', 'label', 'From frappe', {
                        field_name: 'a',
                    }),
                }),
                ...appFiles('ff_app', [docType('FF Other', 'FF Other Module', [])], {
                    'ff_other_module/custom/ff_note.json': {
                        doctype: 'FF Note',
                        custom_fields: [customField('FF Note', 'c', { label: 'From ff_app' })],
                    },
                    'ff_other_module/custom/listed.json': [],
                    'fixtures/property_setter.json': [
                        propertySetter('FF Note', 'label', 'From ff_app', { field_name: 'a' }),
                    ],
                }),
            })

            const [meta] = await loadFromBench(bench, { doctypes: ['FF Note'] })

            expect(meta?.fields.map(({ fieldname, label }) => [fieldname, label])).toStrictEqual([
                ['c', 'From ff_app'],
                ['a', 'From ff_app'],
                ['b', undefined],
            ])
        })

        it("merge a custom folder's custom field into the one the fixtures made, as the sync updates it", async () => {
            const bench = await noteBench(
                [field('a'), field('b')],
                { custom_fields: [customField('FF Note', 'c', { label: 'C' })] },
                {
                    'apps/ff_app/ff_app/fixtures/custom_field.json': JSON.stringify([
                        customField('FF Note', 'c', { insert_after: 'a', reqd: 1 }),
                    ]),
                },
            )

            const [meta] = await loadFromBench(bench, { doctypes: ['FF Note'] })

            expect(meta?.fields.map(({ fieldname, label, reqd }) => [fieldname, label, reqd])).toStrictEqual([
                ['a', undefined, false],
                ['c', 'C', true],
                ['b', undefined, false],
            ])
        })

        it("apply another DocType's rows only when the folder has no file of that DocType", async () => {
            const bench = await tempDir(
                appFiles(
                    'ff_app',
                    [
                        docType('FF Note', 'FF Module', [field('a')]),
                        docType('FF Note Item', 'FF Module', [field('b')], { istable: 1 }),
                        docType('FF Note Tag', 'FF Module', [field('c')], { istable: 1 }),
                    ],
                    {
                        'ff_module/custom/ff_note.json': {
                            doctype: 'FF Note',
                            custom_fields: [
                                customField('FF Note Item', 'item_x', { insert_after: 'b' }),
                                customField('FF Note Tag', 'tag_x', { insert_after: 'c' }),
                            ],
                            property_setters: [
                                propertySetter('FF Note Item', 'label', 'From FF Note', { field_name: 'b' }),
                                propertySetter('FF Note Tag', 'label', 'From FF Note', { field_name: 'c' }),
                            ],
                        },
                        'ff_module/custom/ff_note_item.json': {
                            doctype: 'FF Note Item',
                            custom_fields: [],
                            property_setters: [],
                        },
                    },
                ),
            )

            const docTypes = await loadFromBench(bench, { doctypes: ['FF Note Item', 'FF Note Tag'] })

            expect(
                docTypes.map(({ name, fields }) => [name, fields.map(({ fieldname, label }) => label ?? fieldname)]),
            ).toStrictEqual([
                ['FF Note Item', ['b']],
                ['FF Note Tag', ['From FF Note', 'tag_x']],
            ])
        })
    })

    describe("Frappe's special DocTypes", () => {
        it.each([
            ['15.121.1', ['a', 'b']],
            ['16.35.0', ['a', 'b', 'x']],
        ])(
            'get no customization, but DocPerm its custom fields at the end from Frappe 16 (%s)',
            async (version, docPermFields) => {
                const custom = (doctype: string): JSONObject => ({
                    doctype,
                    custom_fields: [customField(doctype, 'x', { insert_after: 'a' })],
                    property_setters: [propertySetter(doctype, 'label', 'Set', { field_name: 'a' })],
                })
                const bench = await tempDir(
                    appFiles(
                        'frappe',
                        [
                            docType('DocType', 'Core', [field('a'), field('b')]),
                            docType('DocPerm', 'Core', [field('a'), field('b')], { istable: 1 }),
                        ],
                        {
                            '__init__.py': `__version__ = "${version}"\n`,
                            'core/custom/doctype.json': custom('DocType'),
                            'core/custom/docperm.json': custom('DocPerm'),
                        },
                    ),
                )

                const docTypes = await loadFromBench(bench, { doctypes: ['DocType', 'DocPerm'] })

                expect(
                    docTypes.map(({ name, fields }) => [
                        name,
                        fields.map(({ fieldname, label }) => label ?? fieldname),
                    ]),
                ).toStrictEqual([
                    ['DocPerm', docPermFields],
                    ['DocType', ['a', 'b']],
                ])
            },
        )
    })

    describe('selection', () => {
        const bench = (): Promise<string> =>
            tempDir({
                ...appFiles('frappe', [
                    docType('User', 'Core', [field('email')]),
                    docType('Has Role', 'Core', [field('role', 'Link', { options: 'Role' })], { istable: 1 }),
                ]),
                ...appFiles(
                    'ff_app',
                    [
                        docType('FF Order', 'FF Selling', [
                            field('items', 'Table', { options: 'FF Order Item' }),
                            field('roles', 'Table MultiSelect', { options: 'Has Role' }),
                            field('lost', 'Table', { options: 'FF Missing Child' }),
                            field('unnamed', 'Table'),
                            field('customer', 'Link', { options: 'User' }),
                        ]),
                        docType('FF Order Item', 'FF Stock', [field('qty', 'Int')], { istable: 1 }),
                    ],
                    {
                        'ff_selling/custom/user.json': {
                            doctype: 'User',
                            custom_fields: [customField('User', 'ff_nickname', { insert_after: 'email' })],
                            property_setters: [],
                        },
                    },
                ),
            })

        it('reads a DocType of another app with the customizations of this one', async () => {
            const docTypes = await loadFromBench(await bench(), { doctypes: ['User'] })

            expect(docTypes.map(({ name, fields }) => [name, fields.map(({ fieldname }) => fieldname)])).toStrictEqual([
                ['User', ['email', 'ff_nickname']],
            ])
        })

        it('adds the child tables of the selected DocTypes, from any app', async () => {
            const docTypes = await loadFromBench(await bench(), { modules: ['FF Selling'] })

            expect(docTypes.map(({ name }) => name)).toStrictEqual(['FF Order', 'FF Order Item', 'Has Role'])
        })

        it('reads an app, without repeating a child table it selects itself', async () => {
            const docTypes = await loadFromBench(await bench(), { apps: ['ff_app'], doctypes: ['User'] })

            expect(docTypes.map(({ name }) => name)).toStrictEqual(['User', 'FF Order', 'FF Order Item', 'Has Role'])
        })

        it('reads nothing for an empty selection', async () => {
            await expect(loadFromBench(await bench(), {})).resolves.toStrictEqual([])
        })

        it.each([
            [{ doctypes: ['Usr'] }, "DocType 'Usr' is in none of the bench's apps (frappe, ff_app): check its name."],
            [
                { modules: ['Selling'] },
                "Module 'Selling' has no DocTypes in the bench's apps (frappe, ff_app): check its name.",
            ],
            [{ apps: ['erpnext'] }, "App 'erpnext' is not on the bench, which has frappe, ff_app: check its name."],
        ])('fails for %j', async (selection, message) => {
            await expect(loadFromBench(await bench(), selection)).rejects.toThrow(new Error(message))
        })
    })

    describe.each(['v15', 'v16'])("Frappe's own ToDo source (%s)", (version) => {
        it('gives exactly the metadata the site answered', async () => {
            const benchDir = fileURLToPath(new URL(`../fixtures/bench/${version}/`, import.meta.url))

            await expect(loadFromBench(benchDir, { doctypes: ['ToDo'] })).resolves.toStrictEqual(
                recordedBundles(version)['ToDo']?.map(normalizeDocType),
            )
        })
    })
})
