// DocType metadata from a Frappe bench's source: the DocType JSON files of every app in `apps/`, with
// the custom fields and property setters the apps export applied the way `frappe.get_meta` applies them.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { tableFieldtypes } from '../mapping.js'
import { type DocTypeMeta, isRecord, normalizeDocType } from '../meta.js'

type JSONObject = Record<string, unknown>

/** A DocField or Custom Field record, once `normalizeDocType` has checked it: `fieldname` is a string. */
type Field = JSONObject & { fieldname: string }

/** A DocType record as an app stores it, and the app whose file it is. `getMeta` checks the record. */
interface DocTypeFile {
    record: JSONObject & { name: string; module: string; fields: Field[] }
    app: string
}

/** Custom Field and Property Setter records, by the DocType they change. */
interface Customizations {
    customFieldsByDoctype: ReadonlyMap<string, readonly JSONObject[]>
    propertySettersByDoctype: ReadonlyMap<string, readonly JSONObject[]>
}

const missingFileCodes = new Set(['ENOENT', 'ENOTDIR', 'EISDIR'])

/** Whether a file system error says that there is no such file or directory. */
function isMissing(error: unknown): boolean {
    return missingFileCodes.has(String((error as NodeJS.ErrnoException).code))
}

const breakFieldtypes = ['Section Break', 'Column Break', 'Tab Break']

/** Frappe's `Meta.special_doctypes`: `get_meta` customizes none of them. */
const specialDoctypes = new Set([
    'DocField',
    'DocPerm',
    'DocType',
    'Module Def',
    'DocType Action',
    'DocType Link',
    'DocType State',
])

/** A file's text, or `undefined` when there is no such file. */
async function readText(file: string): Promise<string | undefined> {
    try {
        return await readFile(file, 'utf8')
    } catch (error) {
        if (isMissing(error)) return undefined
        throw error
    }
}

/** A JSON file's value, or `undefined` when there is no such file. */
async function readJSON(file: string): Promise<unknown> {
    const text = await readText(file)
    if (text === undefined) return undefined
    try {
        return JSON.parse(text) as unknown
    } catch (error) {
        throw new Error(`Cannot read ${file}: ${(error as Error).message}`, { cause: error })
    }
}

/** The names in a directory, sorted, so that nothing depends on the file system; none when it does not exist. */
async function listDir(dir: string): Promise<string[]> {
    try {
        return (await readdir(dir)).sort()
    } catch (error) {
        if (isMissing(error)) return []
        throw error
    }
}

/** Frappe's `scrub`: the name a module's or DocType's directory has, such as `sales_order`. */
function scrub(name: string): string {
    return name.replaceAll(' ', '_').replaceAll('-', '_').toLowerCase()
}

/**
 * Frappe's `setup_module_map`: each app of the bench, the `apps/<app>` whose Python package
 * `apps/<app>/<app>` has `modules.txt`, with its modules' directory names (`app_modules`). As Frappe's
 * `get_all_apps`, frappe comes first.
 */
async function setupModuleMap(benchDir: string): Promise<Map<string, string[]>> {
    const appModules = new Map<string, string[]>()
    // ponytail: Frappe follows `sites/apps.txt`; the order matters only when two apps set the same property.
    const apps = (await listDir(path.join(benchDir, 'apps'))).sort(
        (a, b) => Number(b === 'frappe') - Number(a === 'frappe'),
    )
    for (const app of apps) {
        const text = await readText(path.join(benchDir, 'apps', app, app, 'modules.txt'))
        if (text === undefined) continue
        // As Frappe's `get_file_items`: without blank lines and `#` comments.
        const modules = text.split(/\r?\n/u).filter((line) => line.trim() !== '' && !line.startsWith('#'))
        appModules.set(
            app,
            modules.map((module) => scrub(module.trim())),
        )
    }
    return appModules
}

/** Whether the bench's frappe is Frappe 15, by `__version__` in its `__init__.py`; not without frappe. */
async function isFrappe15(benchDir: string): Promise<boolean> {
    const text = await readText(path.join(benchDir, 'apps', 'frappe', 'frappe', '__init__.py'))
    return /^__version__\s*=\s*["']15\./mu.test(text ?? '')
}

/**
 * The bench `dir` is in, as bench's `find_parent_bench` finds it: the nearest directory, `dir` or one
 * above it, whose `apps/` holds a Frappe app. An `apps/` without one, such as a JavaScript
 * monorepo's, is passed over, and so is one it may not read, as bench's `os.path.exists` does.
 */
export async function findParentBench(dir: string): Promise<string | undefined> {
    for (let current = path.resolve(dir); ; current = path.dirname(current)) {
        if ((await setupModuleMap(current).catch(() => new Map())).size > 0) return current
        if (path.dirname(current) === current) return undefined
    }
}

/**
 * `DocType.prepare_for_import`: the fields in the order of the file's `field_order`, then the fields
 * it does not name. A DocType's export keeps `fields` in its old order and records the real one there.
 */
function prepareForImport(record: DocTypeFile['record']): Field[] {
    const fieldOrder = record['field_order']
    if (!Array.isArray(fieldOrder)) return record.fields
    const named = fieldOrder.flatMap((fieldname) => record.fields.find((field) => field.fieldname === fieldname) ?? [])
    return [...named, ...record.fields.filter((field) => !fieldOrder.includes(field.fieldname))]
}

/** Every DocType JSON file of the apps: `<module>/doctype/<name>/<name>.json`, in module order. */
async function readDocTypes(
    benchDir: string,
    appModules: ReadonlyMap<string, readonly string[]>,
): Promise<DocTypeFile[]> {
    const docTypes: DocTypeFile[] = []
    // One file at a time: a large bench has over a thousand, and macOS allows 256 open files by default.
    // ponytail: every file of every app is read, even for one DocType; index by name if a large bench is slow.
    for (const [app, modules] of appModules) {
        for (const module of modules) {
            const doctypeDir = path.join(benchDir, 'apps', app, app, module, 'doctype')
            for (const name of await listDir(doctypeDir)) {
                const record = await readJSON(path.join(doctypeDir, name, `${name}.json`))
                if (!isRecord(record) || record['doctype'] !== 'DocType') continue
                docTypes.push({ record: record as DocTypeFile['record'], app })
            }
        }
    }
    return docTypes
}

/** The rows of a list, or none when it is not one. */
function rowsOf(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

/**
 * The Custom Field and Property Setter records the apps export, in the order `bench migrate` syncs
 * them: every app's `fixtures/*.json`, then every module's `custom/*.json`. A record with the same
 * document name as an earlier one replaces it, but for a `custom/` file's custom field, which
 * `sync_customizations_for_doctype` merges into it.
 */
async function readCustomizations(
    benchDir: string,
    appModules: ReadonlyMap<string, readonly string[]>,
): Promise<Customizations> {
    const customFields = new Map<string, JSONObject>()
    const propertySetters = new Map<string, JSONObject>()
    // Keyed by the names Frappe gives these documents.
    const customFieldName = (row: JSONObject): string => `${String(row['dt'])}-${String(row['fieldname'])}`
    const add = (row: unknown, doctype?: string): void => {
        if (!isRecord(row)) return
        const kind = doctype ?? row['doctype']
        if (kind === 'Custom Field') customFields.set(customFieldName(row), row)
        if (kind === 'Property Setter') {
            // `field_name or row_name or "main"`, as Frappe names it.
            const target = [row['field_name'], row['row_name']].find(
                (name): name is string => typeof name === 'string' && name !== '',
            )
            propertySetters.set(`${String(row['doc_type'])}-${target ?? 'main'}-${String(row['property'])}`, row)
        }
    }
    for (const app of appModules.keys()) {
        const fixturesDir = path.join(benchDir, 'apps', app, app, 'fixtures')
        for (const name of (await listDir(fixturesDir)).filter((name) => name.endsWith('.json'))) {
            const data = await readJSON(path.join(fixturesDir, name))
            for (const record of Array.isArray(data) ? data : [data]) add(record)
        }
    }
    for (const [app, modules] of appModules) {
        for (const module of modules) {
            const customDir = path.join(benchDir, 'apps', app, app, module, 'custom')
            const names = await listDir(customDir)
            for (const name of names.filter((name) => name.endsWith('.json'))) {
                const data = await readJSON(path.join(customDir, name))
                if (!isRecord(data)) continue
                // Another DocType's rows, such as a child table's, only when the folder has no file for it.
                const syncs = (doctype: unknown): boolean =>
                    doctype === data['doctype'] || !names.includes(`${scrub(String(doctype))}.json`)
                for (const row of rowsOf(data['custom_fields'])) {
                    // Merged into the existing record, as the sync updates it; a fixture replaces it instead.
                    if (isRecord(row) && syncs(row['dt'])) {
                        add({ ...customFields.get(customFieldName(row)), ...row }, 'Custom Field')
                    }
                }
                for (const row of rowsOf(data['property_setters'])) {
                    if (isRecord(row) && syncs(row['doc_type'])) add(row, 'Property Setter')
                }
            }
        }
    }
    const groupBy = (rows: Iterable<JSONObject>, key: string): Map<string, JSONObject[]> => {
        const byDoctype = new Map<string, JSONObject[]>()
        for (const row of rows) byDoctype.set(String(row[key]), [...(byDoctype.get(String(row[key])) ?? []), row])
        return byDoctype
    }
    return {
        customFieldsByDoctype: groupBy(customFields.values(), 'dt'),
        propertySettersByDoctype: groupBy(propertySetters.values(), 'doc_type'),
    }
}

/**
 * Frappe's `cast` for a property setter's value: `Check` and `Int` become integers, as `cint(sbool(value))`
 * makes them; other values stay as they are, since codegen reads no other number.
 */
function cast(propertyType: unknown, value: unknown): unknown {
    if (propertyType !== 'Check' && propertyType !== 'Int') return value
    const text = String(value).trim().toLowerCase()
    const number = text === 'true' ? 1 : text === 'false' ? 0 : Number(text)
    return Number.isFinite(number) ? Math.trunc(number) : 0
}

/**
 * Frappe's `_update_field_order_based_on_insert_after`: puts each group of fields after its target,
 * again and again so that a field may follow another inserted one; groups whose target never appears go
 * at the end.
 */
function updateFieldOrderBasedOnInsertAfter(fieldOrder: string[], insertionMap: Map<string, string[]>): void {
    let retry = true
    while (retry) {
        retry = false
        for (const [target, fieldnames] of [...insertionMap]) {
            if (!fieldOrder.includes(target)) continue
            fieldOrder.splice(fieldOrder.indexOf(target) + 1, 0, ...fieldnames)
            insertionMap.delete(target)
            retry = true
        }
    }
    for (const fieldnames of insertionMap.values()) fieldOrder.push(...fieldnames)
}

/**
 * Frappe's `Meta.sort_fields`: a `field_order` property setter first; then standard fields in their
 * order, and each custom field after its `insert_after`, or at the top without one. Frappe 16 moves a
 * custom break to the end of the section, column or tab it is put in; Frappe 15 leaves it there.
 */
function sortFields(fieldOrderSetting: unknown, fields: readonly Field[], frappe15: boolean): Field[] {
    const fieldByName = new Map(fields.map((field) => [field.fieldname, field]))
    const fieldtypeByName = new Map(fields.map((field) => [field.fieldname, field['fieldtype']]))
    const toFields = (fieldOrder: readonly string[]): Field[] =>
        fieldOrder.map((fieldname) => fieldByName.get(fieldname)).filter((field) => field !== undefined)
    let fieldOrder: string[] = []
    if (typeof fieldOrderSetting === 'string' && fieldOrderSetting !== '') {
        fieldOrder = (JSON.parse(fieldOrderSetting) as unknown[]).filter(
            (fieldname): fieldname is string => typeof fieldname === 'string' && fieldByName.has(fieldname),
        )
        if (fieldOrder.length === fields.length) return toFields(fieldOrder)
        // When the setting leaves out the first field, the standard fields before the first one it names
        // go first; when it names none of them, the setting is dropped.
        if (fields.findIndex((field) => !fieldOrder.includes(field.fieldname)) === 0) {
            const toPrepend: string[] = []
            let standardFieldFound = false
            for (const [fieldname, field] of fieldByName) {
                if (field['is_custom_field']) break
                if (fieldOrder.includes(fieldname)) {
                    standardFieldFound = true
                    break
                }
                toPrepend.push(fieldname)
            }
            fieldOrder = standardFieldFound ? [...toPrepend, ...fieldOrder] : toPrepend
        }
    }

    const existingFields = fieldOrder.length > 0 ? new Set(fieldOrder) : undefined
    const insertionMap = new Map<string, string[]>()
    const insertAfter = (target: string, fieldname: string): void => {
        insertionMap.set(target, [...(insertionMap.get(target) ?? []), fieldname])
    }
    let previous = ''
    for (const field of fields) {
        if (existingFields?.has(field.fieldname)) {
            // Placed by the setting.
        } else if (!field['is_custom_field']) {
            // In its order, or right after the field before it when the setting places that one.
            if (existingFields === undefined) fieldOrder.push(field.fieldname)
            else insertAfter(previous, field.fieldname)
        } else if (!field['insert_after']) {
            fieldOrder.unshift(field.fieldname)
        } else {
            const originalTarget = field['insert_after'] as string
            let target = originalTarget
            if (!frappe15 && fieldOrder.includes(target) && breakFieldtypes.includes(String(field['fieldtype']))) {
                const isTab = field['fieldtype'] === 'Tab Break'
                for (const fieldname of fieldOrder.slice(fieldOrder.indexOf(target) + 1)) {
                    const fieldtype = fieldtypeByName.get(fieldname)
                    const ends = isTab
                        ? fieldtype === 'Tab Break'
                        : fieldtype === 'Section Break' || fieldtype === fieldtypeByName.get(originalTarget)
                    if (ends) break
                    target = fieldname
                }
            }
            insertAfter(target, field.fieldname)
        }
        previous = field.fieldname
    }
    updateFieldOrderBasedOnInsertAfter(fieldOrder, insertionMap)
    return toFields(fieldOrder)
}

/**
 * Frappe's `get_meta`: the DocType's own fields, its custom fields (by `idx`), its property setters,
 * then `sort_fields`. Frappe's special DocTypes get none of them, but for DocPerm's custom fields on
 * Frappe 16.
 */
function getMeta({ record }: DocTypeFile, customizations: Customizations, frappe15: boolean): DocTypeMeta {
    // Checked here, not when read: a file of an app nobody selects must not stop the run.
    normalizeDocType(record)
    const customFields = [...(customizations.customFieldsByDoctype.get(record.name) ?? [])]
        .sort((a, b) => Number(a['idx'] ?? 0) - Number(b['idx'] ?? 0))
        // `normalizeDocType` checks the fieldname at the end.
        .map((row): Field => ({ ...row, fieldname: row['fieldname'] as string, is_custom_field: 1 }))
    const ownFields = prepareForImport(record)
    if (specialDoctypes.has(record.name)) {
        const withCustomFields = record.name === 'DocPerm' && !frappe15
        return normalizeDocType({ ...record, fields: withCustomFields ? [...ownFields, ...customFields] : ownFields })
    }
    // `prepare_for_import` drops the file's `field_order`; only a property setter sets it again.
    const doc: JSONObject = { ...record, field_order: undefined }
    const fields = [...ownFields, ...customFields].map((field) => ({ ...field }))
    for (const setter of customizations.propertySettersByDoctype.get(record.name) ?? []) {
        const property = String(setter['property'])
        const value = cast(setter['property_type'], setter['value'])
        if (setter['doctype_or_field'] === 'DocType') doc[property] = value
        if (setter['doctype_or_field'] === 'DocField') {
            const field = fields.find(({ fieldname }) => fieldname === setter['field_name'])
            if (field !== undefined) field[property] = value
        }
    }
    return normalizeDocType({ ...doc, fields: sortFields(doc['field_order'], fields, frappe15) })
}

/**
 * Reads DocType metadata from a Frappe bench's source, with no running site: the DocType JSON files of
 * every app in `<benchDir>/apps`, with the custom fields and property setters that the apps export in
 * their modules' `custom/` folders and in their `fixtures/` applied, as Frappe applies them. Every
 * app's customizations apply to every app's DocTypes, so an app's custom fields on frappe's `User`
 * are read when `apps/frappe` is there. A custom Section, Column or Tab Break goes where that frappe's
 * version puts it (`__version__` in `apps/frappe/frappe/__init__.py`), and where Frappe 16 puts it
 * without frappe. DocTypes are selected by name, by module, or by app, and each comes with its child
 * tables.
 *
 * What exists only on a site is not read: custom fields an app creates in Python (such as with
 * `create_custom_fields` in an install hook or a patch), Custom DocTypes, and changes made in the Desk
 * but not exported. The customizations of every app on the bench apply, also of an app a given site
 * does not have.
 *
 * @param benchDir - The bench: the directory whose `apps/<app>/<app>` folders hold the apps.
 * @param selection - The DocTypes to read: by name, by module name, and by app name. All three are
 * combined; an empty selection reads nothing.
 * @returns The metadata of every selected DocType and of every child table they use that the bench has.
 * @throws `Error` naming the DocType, module or app when it is not on the bench, the file when a JSON
 * file cannot be parsed, or the directory when it holds no app.
 * `TypeError` from `normalizeDocType` when the file of a DocType it reads is not DocType metadata; the
 * files of the others are not checked.
 *
 * @example
 * ```ts
 * const docTypes = await loadFromBench('../frappe-bench', { apps: ['my_app'], doctypes: ['User'] })
 * await writeFile('src/frappe.generated.ts', generate(docTypes).code)
 * ```
 */
export async function loadFromBench(
    benchDir: string,
    selection: {
        readonly doctypes?: readonly string[]
        readonly modules?: readonly string[]
        readonly apps?: readonly string[]
    },
): Promise<DocTypeMeta[]> {
    const { doctypes = [], modules = [], apps = [] } = selection
    const appModules = await setupModuleMap(benchDir)
    const allApps = [...appModules.keys()]
    if (allApps.length === 0) throw new Error(`${path.resolve(benchDir)} has no Frappe app in apps/.`)
    const appList = allApps.join(', ')

    // A DocType two apps define, such as `Print Heading` in frappe and ERPNext 15, is the later app's:
    // `bench migrate` imports the apps in order, and each import replaces the DocType.
    const docTypeByName = new Map(
        (await readDocTypes(benchDir, appModules)).map((docType) => [docType.record.name, docType]),
    )
    const all = [...docTypeByName.values()]
    const missingDoctype = doctypes.find((doctype) => !docTypeByName.has(doctype))
    if (missingDoctype !== undefined) {
        throw new Error(`DocType '${missingDoctype}' is in none of the bench's apps (${appList}): check its name.`)
    }
    const missingModule = modules.find((module) => !all.some(({ record }) => record.module === module))
    if (missingModule !== undefined) {
        throw new Error(`Module '${missingModule}' has no DocTypes in the bench's apps (${appList}): check its name.`)
    }
    const missingApp = apps.find((app) => !allApps.includes(app))
    if (missingApp !== undefined) {
        throw new Error(`App '${missingApp}' is not on the bench, which has ${appList}: check its name.`)
    }

    const customizations = await readCustomizations(benchDir, appModules)
    const frappe15 = await isFrappe15(benchDir)
    const selected = all.filter(
        ({ record, app }) => doctypes.includes(record.name) || modules.includes(record.module) || apps.includes(app),
    )
    const metaByDoctype = new Map(
        selected.map((docType) => [docType.record.name, getMeta(docType, customizations, frappe15)]),
    )
    // Each with its child tables, as `getdoctype` answers: a child table has none of its own.
    for (const meta of [...metaByDoctype.values()]) {
        for (const field of meta.fields) {
            const child = tableFieldtypes.has(field.fieldtype) ? docTypeByName.get(field.options ?? '') : undefined
            if (child !== undefined && !metaByDoctype.has(child.record.name)) {
                metaByDoctype.set(child.record.name, getMeta(child, customizations, frappe15))
            }
        }
    }
    return [...metaByDoctype.values()]
}
