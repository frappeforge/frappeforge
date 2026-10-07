#!/usr/bin/env node
/**
 * Refreshes the metadata fixtures the golden files are generated from: run by hand against a Frappe
 * site, never in CI.
 *
 *     node --env-file=<file> scripts/record-meta.mjs
 *
 * Reads FRAPPE_URL, FRAPPE_SITE_NAME (optional), FRAPPE_API_KEY and FRAPPE_API_SECRET from the
 * environment. For each DocType below, it asks `frappe.desk.form.load.getdoctype` for the DocType and
 * its child tables, keeps only the keys `normalizeDocType` reads, and writes
 * `tests/fixtures/meta/v<major>/<doctype>.json`, the folder named after the site's Frappe version.
 * The folder is emptied first, so a DocType dropped from the list leaves no stale file. Format the
 * output with Prettier afterwards.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient, tokenAuth } from '@frappeforge/client'

/** Present on every Frappe site: small, and the usual first example. */
const frappeDocTypes = ['ToDo']
/** An autoincrement DocType, recorded when the site has it. */
const counterDocType = 'FF Counter'
/** A large, real DocType, recorded when ERPNext is installed. */
const erpnextDocTypes = ['Sales Order']

const docTypeKeys = ['name', 'module', 'istable', 'issingle', 'is_submittable', 'autoname', 'description', 'fields']
const fieldKeys = [
    'fieldname',
    'fieldtype',
    'label',
    'options',
    'reqd',
    'permlevel',
    'is_virtual',
    'mask',
    'description',
]

/** The record with only `keys`, in that order; keys it does not have stay absent. */
function pick(record, keys) {
    return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]))
}

/** Frappe's `scrub`: the name a DocType's files are stored under. */
function scrub(name) {
    return name.replaceAll(' ', '_').replaceAll('-', '_').toLowerCase()
}

function requireEnv(name) {
    const value = process.env[name]
    if (!value) throw new Error(`${name} is not set. Run with --env-file=<file>.`)
    return value
}

const frappe = createClient({
    url: requireEnv('FRAPPE_URL'),
    ...(process.env['FRAPPE_SITE_NAME'] ? { siteName: process.env['FRAPPE_SITE_NAME'] } : {}),
    auth: tokenAuth({ apiKey: requireEnv('FRAPPE_API_KEY'), apiSecret: requireEnv('FRAPPE_API_SECRET') }),
})

const { message: versions } = await frappe.request({ path: '/api/method/frappe.utils.change_log.get_versions' })
const frappeVersion = versions.frappe.version
const erpnextVersion = versions.erpnext?.version
const recordedFrom = `Frappe ${frappeVersion}${erpnextVersion ? `, ERPNext ${erpnextVersion}` : ''}`

const docTypes = [
    ...frappeDocTypes,
    ...((await frappe.doc.exists('DocType', counterDocType)) ? [counterDocType] : []),
    ...(erpnextVersion ? erpnextDocTypes : []),
]

const folder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    `../tests/fixtures/meta/v${frappeVersion.split('.')[0]}`,
)
mkdirSync(folder, { recursive: true })
for (const file of readdirSync(folder).filter((name) => name.endsWith('.json'))) rmSync(path.join(folder, file))

for (const doctype of docTypes) {
    const { docs } = await frappe.request({
        path: '/api/method/frappe.desk.form.load.getdoctype',
        query: { doctype },
    })
    const trimmed = docs.map((doc) => ({
        ...pick(doc, docTypeKeys),
        fields: doc.fields.map((field) => pick(field, fieldKeys)),
    }))
    const file = path.join(folder, `${scrub(doctype)}.json`)
    writeFileSync(file, `${JSON.stringify({ recordedFrom, doctype, docs: trimmed }, null, 4)}\n`)
    console.log(`${path.relative(process.cwd(), file)}: ${trimmed.map((doc) => doc.name).join(', ')}`)
}
console.log(`Recorded ${String(docTypes.length)} DocTypes from ${recordedFrom}.`)
