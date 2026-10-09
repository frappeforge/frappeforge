// DocType metadata from a running site. `frappe.desk.form.load.getdoctype` answers with the merged
// metadata — custom fields and property setters applied — of a DocType and all its child tables.

import {
    AuthenticationError,
    type DocNamespace,
    type FrappeClient,
    NotFoundError,
    PermissionError,
    ValidationError,
} from '@frappeforge/client'

import { type DocTypeMeta, normalizeDocType } from '../meta.js'

/** Requests in flight at once: quick on a large selection, and gentle on the site's workers. */
const CONCURRENCY = 4

type SiteClient = Parameters<typeof loadFromSite>[0]

/** Every row of a list, with a readable error when the user may not list DocTypes. */
async function collectRows<const F extends readonly string[]>(
    frappe: SiteClient,
    doctype: string,
    fields: F,
    filters: Readonly<Record<string, readonly ['in', readonly string[]]>>,
): Promise<Record<F[number], unknown>[]> {
    const rows: Record<F[number], unknown>[] = []
    try {
        for await (const row of frappe.doc.paginate(doctype, { fields, filters })) rows.push(row)
    } catch (error) {
        if (error instanceof PermissionError) {
            throw new Error(
                'Selecting by module or app lists DocTypes, which needs the System Manager role. ' +
                    'Give the API user that role, or select the DocTypes by name.',
                { cause: error },
            )
        }
        throw error
    }
    return rows
}

/** The names of the DocTypes of the modules and apps, tables last, so that most arrive with their parent. */
async function listDoctypes(
    frappe: SiteClient,
    modules: readonly string[],
    apps: readonly string[],
): Promise<string[]> {
    const appModules: string[] = []
    if (apps.length > 0) {
        const rows = await collectRows(frappe, 'Module Def', ['name', 'app_name'], { app_name: ['in', apps] })
        const missingApp = apps.find((app) => !rows.some((row) => row.app_name === app))
        if (missingApp !== undefined) {
            throw new Error(`App '${missingApp}' has no modules on ${frappe.url}: check its name.`)
        }
        appModules.push(...rows.map((row) => String(row.name)))
    }
    const allModules = [...new Set([...modules, ...appModules])]
    if (allModules.length === 0) return []
    const rows = await collectRows(frappe, 'DocType', ['name', 'module', 'istable'], { module: ['in', allModules] })
    // Only a module named by the caller must have DocTypes; one of an app may hold only reports or pages.
    const missingModule = modules.find((module) => !rows.some((row) => row.module === module))
    if (missingModule !== undefined) {
        throw new Error(`Module '${missingModule}' has no DocTypes on ${frappe.url}: check its name.`)
    }
    return [...rows.filter((row) => !row.istable), ...rows.filter((row) => row.istable)].map((row) => String(row.name))
}

/**
 * Frappe's `get_meta_bundle`, as `frappe.desk.form.load.getdoctype` answers it in `docs`: the DocType's
 * metadata, then its child tables'.
 */
async function getMetaBundle(frappe: SiteClient, doctype: string): Promise<unknown[]> {
    let body: { docs?: unknown }
    try {
        body = await frappe.request({ path: '/api/method/frappe.desk.form.load.getdoctype', query: { doctype } })
    } catch (error) {
        // Left as it is: it is about the credentials, not this DocType.
        if (error instanceof AuthenticationError) throw error
        // The site's message names the missing DocType: this one, or a child table it uses.
        throw new Error(`Cannot read DocType '${doctype}' on ${frappe.url}: ${(error as Error).message}`, {
            cause: error,
        })
    }
    if (!Array.isArray(body.docs)) {
        throw new TypeError(`${frappe.url} answered getdoctype for '${doctype}' without its \`docs\`.`)
    }
    return body.docs as unknown[]
}

/** What {@link loadFromSite} returns. */
export interface LoadFromSiteResult {
    /** The metadata of every DocType read, child tables included, each once, ready for `generate()`. */
    docTypes: DocTypeMeta[]
    /** One message for each DocType left out because it refers to a DocType the site does not have, sorted. */
    warnings: readonly string[]
}

/**
 * Reads DocType metadata from a running site, as the site's forms see it: custom fields and property
 * setters are applied. DocTypes are selected by name, by module, or by installed app, and each comes
 * with its child tables. Up to four requests run at once.
 *
 * A DocType selected by module or app whose metadata the site cannot load because it refers to a
 * DocType that is not installed — through a link or a child table — is left out with a warning. One
 * named in `doctypes` fails the call instead.
 *
 * Reading the metadata of DocTypes named in `doctypes` needs only a logged-in user. Selecting by
 * module or app lists DocTypes, which needs the System Manager role.
 *
 * @param frappe - A client for the site, from `createClient` — typed with your DocTypes or not.
 * @param selection - The DocTypes to read: by name, by module name, and by app name. All three are
 * combined; an empty selection reads nothing.
 * @returns The metadata of every selected DocType and of every child table they use, and a warning
 * for each DocType left out.
 * @throws `Error` naming the DocType, module or app when a DocType cannot be read, a module has no
 * DocTypes, an app has no modules, or the user may not list DocTypes; the client's error is its
 * `cause`. An `AuthenticationError` is thrown as it is.
 *
 * @example
 * ```ts
 * const frappe = createClient({ url: 'https://example.com', auth: tokenAuth({ apiKey, apiSecret }) })
 * const { docTypes, warnings } = await loadFromSite(frappe, { doctypes: ['ToDo'], modules: ['Selling'] })
 * await writeFile('src/frappe.generated.ts', generate(docTypes).code)
 * ```
 */
export async function loadFromSite(
    // Only what is used, so that any client fits, whatever DocTypes it is typed with.
    frappe: Pick<FrappeClient<object>, 'url' | 'request'> & { readonly doc: Pick<DocNamespace<object>, 'paginate'> },
    selection: {
        readonly doctypes?: readonly string[]
        readonly modules?: readonly string[]
        readonly apps?: readonly string[]
    },
): Promise<LoadFromSiteResult> {
    const { doctypes = [], modules = [], apps = [] } = selection
    const queue = [...new Set([...doctypes, ...(await listDoctypes(frappe, modules, apps))])]
    const metaByDoctype = new Map<string, DocTypeMeta>()
    const warnings: string[] = []

    const worker = async (): Promise<void> => {
        try {
            for (let doctype = queue.shift(); doctype !== undefined; doctype = queue.shift()) {
                // A child table usually arrives with its parent's answer.
                if (metaByDoctype.has(doctype)) continue
                let docs: unknown[]
                try {
                    docs = await getMetaBundle(frappe, doctype)
                } catch (error) {
                    // Frappe answers 417 for a link, and 404 for a child table, to a DocType that is not
                    // installed; a listed DocType exists itself.
                    const cause = (error as Error).cause
                    const refused = cause instanceof ValidationError || cause instanceof NotFoundError
                    if (doctypes.includes(doctype) || !refused) throw error
                    warnings.push(
                        `DocType '${doctype}': ${frappe.url} cannot load its metadata, so it is not generated. ${cause.message}`,
                    )
                    continue
                }
                for (const meta of docs.map(normalizeDocType)) {
                    if (!metaByDoctype.has(meta.name)) metaByDoctype.set(meta.name, meta)
                }
            }
        } catch (error) {
            // No new request starts once one has failed.
            queue.length = 0
            throw error
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    // Sorted: the workers finish in any order.
    return { docTypes: [...metaByDoctype.values()], warnings: warnings.sort() }
}
