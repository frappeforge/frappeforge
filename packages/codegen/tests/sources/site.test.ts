import {
    AuthenticationError,
    createClient,
    NotFoundError,
    PermissionError,
    ServerError,
    tokenAuth,
    ValidationError,
} from '@frappeforge/client'
import { describe, expect, it } from 'vitest'

import { normalizeDocType } from '../../src/meta.js'
import { loadFromSite } from '../../src/sources/site.js'
import { docTypeRecord, frappeError, json, recordedBundles, stubSite, type StubSiteOptions } from '../support/site.js'

const v15Bundles = recordedBundles('v15')

/** The v15Bundles answers, plus the answer for each child table on its own, as the site gives it. */
const bundles: Record<string, readonly unknown[]> = { ...v15Bundles }
for (const docs of Object.values(v15Bundles)) {
    for (const child of docs.slice(1)) bundles[(child as { name: string }).name] = [child]
}

/** The `DocType` list rows of the v15Bundles DocTypes. */
const docTypeRows = Object.values(bundles).map((docs) => {
    const { name, module, istable = 0 } = docs[0] as { name: string; module: string; istable?: number }
    return { name, module, istable }
})

const moduleDefRows = [
    { name: 'Desk', app_name: 'frappe' },
    { name: 'Custom', app_name: 'frappe' },
    { name: 'Selling', app_name: 'erpnext' },
    { name: 'Stock', app_name: 'erpnext' },
    { name: 'Accounts', app_name: 'erpnext' },
    // A module with no DocTypes, as some apps have.
    { name: 'Utilities', app_name: 'erpnext' },
]

function site(options: StubSiteOptions = {}) {
    const stub = stubSite({ bundles, docTypeRows, moduleDefRows, ...options })
    const frappe = createClient({
        url: 'https://example.com',
        auth: tokenAuth({ apiKey: 'key', apiSecret: 'secret' }),
        fetch: stub.fetch,
    })
    return { frappe, stub }
}

function names(metas: readonly { name: string }[]): string[] {
    return metas.map((meta) => meta.name).sort()
}

function requestedDoctypes(requests: readonly URL[]): string[] {
    return requests
        .filter((url) => url.pathname.endsWith('.getdoctype'))
        .map((url) => url.searchParams.get('doctype') ?? '')
}

/** Delays the meta bundles of these DocTypes, so that the other workers run ahead. */
function delayBundles(doctypes: readonly string[], ms = 50): NonNullable<StubSiteOptions['intercept']> {
    return async (request) => {
        const doctype = new URL(request.url).searchParams.get('doctype') ?? ''
        if (doctypes.includes(doctype)) await new Promise((resolve) => setTimeout(resolve, ms))
        return undefined
    }
}

describe('loadFromSite', () => {
    it('reads named DocTypes with their child tables, and lists nothing', async () => {
        const { frappe, stub } = site()

        const { docTypes: metas, warnings } = await loadFromSite(frappe, { doctypes: ['ToDo', 'Sales Order'] })

        expect(names(metas)).toStrictEqual([
            'Packed Item',
            'Payment Schedule',
            'Pricing Rule Detail',
            'Sales Order',
            'Sales Order Item',
            'Sales Taxes and Charges',
            'Sales Team',
            'ToDo',
        ])
        expect(metas.find((meta) => meta.name === 'ToDo')).toStrictEqual(normalizeDocType(v15Bundles['ToDo']?.[0]))
        expect(warnings).toStrictEqual([])
        // Reading metadata by name needs no right to list DocTypes.
        expect(stub.requests.every((url) => url.pathname.endsWith('.getdoctype'))).toBe(true)
        expect(requestedDoctypes(stub.requests)).toStrictEqual(['ToDo', 'Sales Order'])
    })

    it('asks getdoctype with the token and the DocType name', async () => {
        const { frappe, stub } = site({
            intercept: (request) => {
                expect(request.headers.get('authorization')).toBe('token key:secret')
                return undefined
            },
        })

        await loadFromSite(frappe, { doctypes: ['FF Counter'] })

        expect(stub.requests.map(String)).toStrictEqual([
            'https://example.com/api/method/frappe.desk.form.load.getdoctype?doctype=FF+Counter',
        ])
    })

    it('reads every DocType of a module, child tables included', async () => {
        const { frappe, stub } = site()

        const { docTypes: metas } = await loadFromSite(frappe, { modules: ['Selling'] })

        expect(names(metas)).toStrictEqual([
            'Packed Item',
            'Payment Schedule',
            'Pricing Rule Detail',
            'Sales Order',
            'Sales Order Item',
            'Sales Taxes and Charges',
            'Sales Team',
        ])
        const [list] = stub.requests
        expect(list?.pathname).toBe('/api/resource/DocType')
        expect(JSON.parse(list?.searchParams.get('filters') ?? '')).toStrictEqual([['module', 'in', ['Selling']]])
        // Tables come last, after the DocTypes whose answers usually bring them.
        expect(requestedDoctypes(stub.requests)[0]).toBe('Sales Order')
    })

    it('reads every DocType of an app through its modules', async () => {
        const { frappe, stub } = site()

        const { docTypes: metas } = await loadFromSite(frappe, { apps: ['frappe'] })

        expect(names(metas)).toStrictEqual(['FF Counter', 'ToDo'])
        const [modules, list] = stub.requests
        expect(modules?.pathname).toBe('/api/resource/Module%20Def')
        expect(JSON.parse(modules?.searchParams.get('filters') ?? '')).toStrictEqual([['app_name', 'in', ['frappe']]])
        expect(JSON.parse(list?.searchParams.get('filters') ?? '')).toStrictEqual([
            ['module', 'in', ['Desk', 'Custom']],
        ])
    })

    it('allows a module of an app to have no DocTypes', async () => {
        const { frappe } = site()

        const { docTypes: metas } = await loadFromSite(frappe, { apps: ['erpnext'] })

        expect(metas.map((meta) => meta.name)).toContain('Sales Order')
    })

    it('combines names, modules and apps, and reads each DocType once', async () => {
        const { frappe, stub } = site()

        const { docTypes: metas } = await loadFromSite(frappe, {
            doctypes: ['Sales Order', 'ToDo', 'Sales Order'],
            modules: ['Desk', 'Selling'],
            apps: ['frappe'],
        })

        expect(new Set(names(metas)).size).toBe(metas.length)
        expect(names(metas)).toContain('FF Counter')
        const requested = requestedDoctypes(stub.requests)
        expect(new Set(requested).size).toBe(requested.length)
    })

    it('skips a child table that an earlier answer brought', async () => {
        const { frappe, stub } = site({ intercept: delayBundles(['ToDo', 'FF Counter', 'Sales Team']) })

        const { docTypes: metas } = await loadFromSite(frappe, {
            doctypes: ['ToDo', 'FF Counter', 'Sales Team', 'Sales Order', 'Sales Order Item', 'Packed Item'],
        })

        expect(metas).toHaveLength(9)
        expect(requestedDoctypes(stub.requests)).toStrictEqual(['ToDo', 'FF Counter', 'Sales Team', 'Sales Order'])
    })

    it('keeps the first answer for a DocType that two answers bring', async () => {
        const sharedItem = docTypeRecord('FF Shared Item', { istable: 1 })
        const { frappe } = site({
            bundles: {
                'FF First': [docTypeRecord('FF First'), sharedItem],
                'FF Second': [docTypeRecord('FF Second'), { ...sharedItem, description: 'Changed' }],
            },
        })

        const { docTypes: metas } = await loadFromSite(frappe, { doctypes: ['FF First', 'FF Second'] })

        expect(metas.filter((meta) => meta.name === 'FF Shared Item')).toHaveLength(1)
    })

    it('runs at most four requests at once', async () => {
        const doctypes = Array.from({ length: 10 }, (_, index) => `FF Doc ${String(index)}`)
        const { frappe, stub } = site({
            bundles: Object.fromEntries(doctypes.map((name) => [name, [docTypeRecord(name)]])),
        })

        const { docTypes: metas } = await loadFromSite(frappe, { doctypes })

        expect(names(metas)).toStrictEqual([...doctypes].sort())
        expect(stub.requests).toHaveLength(10)
        expect(stub.maxInFlight).toBe(4)
    })

    it('reads nothing for an empty selection', async () => {
        const { frappe, stub } = site()

        await expect(loadFromSite(frappe, {})).resolves.toStrictEqual({ docTypes: [], warnings: [] })
        expect(stub.requests).toStrictEqual([])
    })

    it('names a DocType that does not exist, with the site message, and keeps the client error as the cause', async () => {
        const { frappe } = site()

        const error = await loadFromSite(frappe, { doctypes: ['Custmer'] }).catch((thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe(
            "Cannot read DocType 'Custmer' on https://example.com: DocType Custmer not found",
        )
        expect((error as Error).cause).toBeInstanceOf(NotFoundError)
    })

    // Frappe answers 417 for a link, and 404 for a child table, to a DocType that is not installed.
    it.each([
        [417, 'ValidationError', 'Field payment_gateway is referring to non-existing doctype Payment Gateway.'],
        [404, 'DoesNotExistError', 'DocType Payment Gateway Item not found'],
    ])(
        'leaves out, with a warning, a DocType selected by module whose metadata the site refuses with %i',
        async (status, excType, message) => {
            const refuseBundles =
                (doctypes: readonly string[]): NonNullable<StubSiteOptions['intercept']> =>
                (request) =>
                    doctypes.includes(new URL(request.url).searchParams.get('doctype') ?? '')
                        ? frappeError(status, excType, message)
                        : undefined
            const { frappe } = site({ intercept: refuseBundles(['ToDo', 'FF Counter']) })

            const { docTypes: metas, warnings } = await loadFromSite(frappe, {
                modules: ['Desk', 'Custom', 'Selling'],
            })

            // Sorted, whichever request finishes first.
            expect(warnings).toStrictEqual(
                ['FF Counter', 'ToDo'].map(
                    (doctype) =>
                        `DocType '${doctype}': https://example.com cannot load its metadata, so it is not generated. ${message}`,
                ),
            )
            expect(names(metas)).not.toContain('ToDo')
            expect(names(metas)).toContain('Sales Order')
        },
    )

    it('fails, naming it, for a named DocType whose metadata the site refuses', async () => {
        const { frappe } = site({ intercept: () => frappeError(417, 'ValidationError') })

        const error = await loadFromSite(frappe, { doctypes: ['ToDo'] }).catch((thrown: unknown) => thrown)

        expect((error as Error).message).toMatch(/^Cannot read DocType 'ToDo' on https:\/\/example\.com: /u)
        expect((error as Error).cause).toBeInstanceOf(ValidationError)
    })

    it('fails, naming the DocType, for any other error, even when selected by module', async () => {
        const { frappe } = site({
            intercept: (request) => (request.url.includes('getdoctype') ? frappeError(500, 'ImportError') : undefined),
        })

        const error = await loadFromSite(frappe, { modules: ['Desk'] }).catch((thrown: unknown) => thrown)

        expect((error as Error).message).toMatch(/^Cannot read DocType 'ToDo' on https:\/\/example\.com: /u)
        expect((error as Error).cause).toBeInstanceOf(ServerError)
    })

    it('starts no request after one has failed', async () => {
        const slowDoctypes = ['ToDo', 'FF Counter', 'Sales Order', 'Sales Team', 'Packed Item', 'Payment Schedule']
        const { frappe, stub } = site({ intercept: delayBundles(slowDoctypes) })

        await expect(loadFromSite(frappe, { doctypes: ['Custmer', ...slowDoctypes] })).rejects.toThrow(
            "Cannot read DocType 'Custmer'",
        )
        // Let the requests already running finish.
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(requestedDoctypes(stub.requests)).toStrictEqual(['Custmer', 'ToDo', 'FF Counter', 'Sales Order'])
    })

    it('names a module with no DocTypes', async () => {
        const { frappe } = site()

        await expect(loadFromSite(frappe, { modules: ['Selling', 'Sellng'] })).rejects.toThrow(
            "Module 'Sellng' has no DocTypes on https://example.com: check its name.",
        )
    })

    it('names an app with no modules', async () => {
        const { frappe } = site()

        await expect(loadFromSite(frappe, { apps: ['erpnxt'] })).rejects.toThrow(
            "App 'erpnxt' has no modules on https://example.com: check its name.",
        )
    })

    it('explains that listing DocTypes needs the System Manager role', async () => {
        const { frappe } = site({
            intercept: (request) =>
                request.url.includes('/api/resource/DocType') ? frappeError(403, 'PermissionError') : undefined,
        })

        const error = await loadFromSite(frappe, { modules: ['Desk'] }).catch((thrown: unknown) => thrown)

        expect((error as Error).message).toBe(
            'Selecting by module or app lists DocTypes, which needs the System Manager role. Give the API user that role, or select the DocTypes by name.',
        )
        expect((error as Error).cause).toBeInstanceOf(PermissionError)
    })

    it('passes other client errors through', async () => {
        const answerUnauthorized = () => frappeError(401, 'AuthenticationError')

        await expect(
            loadFromSite(site({ intercept: answerUnauthorized }).frappe, { doctypes: ['ToDo'] }),
        ).rejects.toThrow(AuthenticationError)
        await expect(
            loadFromSite(site({ intercept: answerUnauthorized }).frappe, { modules: ['Desk'] }),
        ).rejects.toThrow(AuthenticationError)
    })

    it('rejects an answer without docs', async () => {
        const { frappe } = site({ intercept: () => json(200, { message: 'ok' }) })

        await expect(loadFromSite(frappe, { doctypes: ['ToDo'] })).rejects.toThrow(
            new TypeError("https://example.com answered getdoctype for 'ToDo' without its `docs`."),
        )
    })

    it('rejects metadata that is not a DocType', async () => {
        const { frappe } = site({ bundles: { 'FF Broken': [{ name: 'FF Broken' }] } })

        await expect(loadFromSite(frappe, { doctypes: ['FF Broken'] })).rejects.toThrow(TypeError)
    })
})
