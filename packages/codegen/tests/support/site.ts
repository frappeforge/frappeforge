import { readdirSync, readFileSync } from 'node:fs'

/** A row of the site's `DocType` or `Module Def` list. */
type Row = Readonly<Record<string, string | number>>

/** What the stub site holds, and how it answers. */
export interface StubSiteOptions {
    /** `getdoctype` answers: the `docs` for each DocType that exists. */
    bundles?: Readonly<Record<string, readonly unknown[]>>
    /** Rows of `/api/resource/DocType`: `name`, `module`, `istable`. */
    docTypeRows?: readonly Row[]
    /** Rows of `/api/resource/Module Def`: `name`, `app_name`. */
    moduleDefRows?: readonly Row[]
    /** Answers a request before the site does, such as with an error; `undefined` lets the site answer. */
    intercept?: (request: Request) => Response | undefined | Promise<Response | undefined>
}

/** The recorded `getdoctype` answers in `tests/fixtures/meta/<folder>`, by the DocType asked for. */
export function recordedBundles(folder: string): Record<string, readonly unknown[]> {
    const dir = new URL(`../fixtures/meta/${folder}/`, import.meta.url)
    const bundles: Record<string, readonly unknown[]> = {}
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
        const { doctype, docs } = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as {
            doctype: string
            docs: unknown[]
        }
        bundles[doctype] = docs
    }
    return bundles
}

/** A minimal DocType record, as `getdoctype` returns it. */
export function docTypeRecord(name: string, extra: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    return { name, module: 'Custom', fields: [], ...extra }
}

/** A JSON response, with Frappe's content type. */
export function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Frappe's answer for an exception: `exc_type`, the HTTP status that goes with it, and the message, if any. */
export function frappeError(status: number, excType: string, message?: string): Response {
    return json(status, {
        exc_type: excType,
        ...(message === undefined ? {} : { _server_messages: JSON.stringify([JSON.stringify({ message })]) }),
    })
}

/** Keeps the rows that match every `[field, 'in', values]` filter, with only the asked-for fields. */
function listRows(rows: readonly Row[], url: URL): Row[] {
    const filters = JSON.parse(url.searchParams.get('filters') ?? '[]') as [string, string, unknown][]
    const fields = JSON.parse(url.searchParams.get('fields') ?? '["name"]') as string[]
    return rows
        .filter((row) =>
            filters.every(([field, operator, value]) => {
                if (operator !== 'in') throw new Error(`stubSite: unsupported filter operator ${operator}`)
                return (value as unknown[]).includes(row[field])
            }),
        )
        .map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null])) as Row)
}

/**
 * A Frappe site in a `fetch` function, answering `getdoctype` and the `DocType` and `Module Def`
 * lists. Every answer waits one macrotask, so requests overlap as on a real site; `maxInFlight` is
 * the most that were ever open at once.
 */
export function stubSite(options: StubSiteOptions = {}): {
    fetch: (request: Request) => Promise<Response>
    requests: URL[]
    readonly maxInFlight: number
} {
    const { bundles = {}, docTypeRows = [], moduleDefRows = [], intercept } = options
    const requests: URL[] = []
    let inFlight = 0
    let maxInFlight = 0

    const answer = (request: Request, url: URL): Response => {
        if (url.pathname === '/api/method/frappe.desk.form.load.getdoctype') {
            const doctype = url.searchParams.get('doctype') ?? ''
            const docs = bundles[doctype]
            return docs === undefined
                ? frappeError(404, 'DoesNotExistError', `DocType ${doctype} not found`)
                : json(200, { docs, user_settings: {} })
        }
        if (url.pathname === '/api/resource/DocType') return json(200, { data: listRows(docTypeRows, url) })
        if (url.pathname === '/api/resource/Module%20Def') return json(200, { data: listRows(moduleDefRows, url) })
        throw new Error(`stubSite: no route for ${request.method} ${request.url}`)
    }

    const fetch = async (request: Request): Promise<Response> => {
        const url = new URL(request.url)
        requests.push(url)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        try {
            await new Promise((resolve) => setTimeout(resolve, 0))
            return (await intercept?.(request)) ?? answer(request, url)
        } finally {
            inFlight -= 1
        }
    }
    return {
        fetch,
        requests,
        get maxInFlight() {
            return maxInFlight
        },
    }
}
