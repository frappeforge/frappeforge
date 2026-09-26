import { describe, expect, it } from 'vitest'

import { CancelledError, ConfigurationError, createClient, FrappeError, NotFoundError } from '../../src/index.js'
import { json, only, type Reply, stubFetch } from '../support/fetch.js'

const url = 'https://example.com'

function client(replies: Reply[]) {
    const { fetch, requests } = stubFetch(replies)
    return { frappe: createClient({ url, fetch }), requests }
}

/** The path, as sent. */
function pathOf(request: Request): string {
    return new URL(request.url).pathname
}

/** The query string, decoded, with JSON values parsed. */
function queryOf(request: Request): Record<string, unknown> {
    return Object.fromEntries(
        [...new URL(request.url).searchParams].map(([key, value]) => {
            try {
                return [key, JSON.parse(value) as unknown]
            } catch {
                return [key, value]
            }
        }),
    )
}

/** Names that must reach Frappe unchanged: every character that means something in a URL. */
const awkwardNames = [
    ['a slash', 'A/B', 'A%2FB'],
    ['a hash', 'A#1', 'A%231'],
    ['a question mark', 'Why?', 'Why%3F'],
    ['a percent sign', '100%', '100%25'],
    ['an ampersand', 'R&D', 'R%26D'],
    ['a space', 'Sales Invoice', 'Sales%20Invoice'],
    ['non-ASCII', 'Tâche-été', 'T%C3%A2che-%C3%A9t%C3%A9'],
    ['a percent-encoded dot', '%2e', '%252e'],
] as const

describe('doc.get', () => {
    it('reads /api/resource/{doctype}/{name} and returns `data`', async () => {
        const doc = { name: 'TODO-0001', doctype: 'ToDo', description: 'Ship it' }
        const { frappe, requests } = client([json(200, { data: doc })])
        await expect(frappe.doc.get('ToDo', 'TODO-0001')).resolves.toEqual(doc)
        const request = only(requests)
        expect(request.method).toBe('GET')
        expect(request.url).toBe(`${url}/api/resource/ToDo/TODO-0001`)
    })

    it.each(awkwardNames)('encodes a name with %s', async (_title, name, encoded) => {
        const { frappe, requests } = client([json(200, { data: { name } })])
        await frappe.doc.get('Sales Invoice', name)
        expect(pathOf(only(requests))).toBe(`/api/resource/Sales%20Invoice/${encoded}`)
    })

    it.each([
        ['an empty doctype', '', 'X', '`doctype` must be a non-empty string.'],
        ['a doctype that is not a string', 1, 'X', '`doctype` must be a non-empty string.'],
        ['an empty name', 'ToDo', '', '`name` must be a non-empty string.'],
        ['a name that is not a string', 'ToDo', 42, '`name` must be a non-empty string.'],
    ])('rejects %s without sending', async (_title, doctype, name, message) => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.get(doctype as string, name as string)).rejects.toThrow(new ConfigurationError(message))
        expect(requests).toHaveLength(0)
    })

    it('rejects with the status error', async () => {
        const { frappe } = client([json(404, { exc_type: 'DoesNotExistError' })])
        await expect(frappe.doc.get('ToDo', 'nope')).rejects.toBeInstanceOf(NotFoundError)
    })

    it.each([
        ['no `data`', { message: 'ok' }],
        ['a list in `data`', { data: [] }],
        ['an empty body', undefined],
    ])('rejects a response with %s', async (_title, body) => {
        const { frappe } = client([body === undefined ? new Response(null, { status: 200 }) : json(200, body)])
        const error = await frappe.doc.get('ToDo', 'TODO-0001').catch((reason: unknown) => reason)
        expect(error).toBeInstanceOf(FrappeError)
        expect(error).toMatchObject({
            message: `Expected a document in \`data\` from GET ${url}/api/resource/ToDo/TODO-0001.`,
            status: 200,
            request: { method: 'GET', url: `${url}/api/resource/ToDo/TODO-0001` },
        })
    })
})

describe('doc.getSingle', () => {
    it('reads /api/resource/{doctype}/{doctype}', async () => {
        const settings = { name: 'System Settings', doctype: 'System Settings', country: 'Jordan' }
        const { frappe, requests } = client([json(200, { data: settings })])
        await expect(frappe.doc.getSingle('System Settings')).resolves.toEqual(settings)
        expect(pathOf(only(requests))).toBe('/api/resource/System%20Settings/System%20Settings')
    })

    it('rejects an empty doctype without sending', async () => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.getSingle('')).rejects.toBeInstanceOf(ConfigurationError)
        expect(requests).toHaveLength(0)
    })
})

describe('doc.list', () => {
    it('reads /api/resource/{doctype} and returns `data`', async () => {
        const rows = [{ name: 'TODO-0001' }, { name: 'TODO-0002' }]
        const { frappe, requests } = client([json(200, { data: rows })])
        await expect(frappe.doc.list('ToDo')).resolves.toEqual(rows)
        const request = only(requests)
        expect(request.method).toBe('GET')
        expect(pathOf(request)).toBe('/api/resource/ToDo')
        // No `fields`: Frappe returns `name` alone.
        expect(queryOf(request)).toEqual({ limit_start: 0, limit_page_length: 20 })
    })

    it('sends every argument in the query', async () => {
        const { frappe, requests } = client([json(200, { data: [] })])
        await frappe.doc.list('ToDo', {
            fields: ['name', 'status'],
            filters: { status: 'Open', allocated_to: ['is', 'set'] },
            orFilters: [['priority', '=', 'High']],
            orderBy: [{ field: 'priority', order: 'desc' }, { field: 'modified' }],
            groupBy: 'status',
            limit: 50,
            offset: 100,
        })
        expect(queryOf(only(requests))).toEqual({
            fields: ['name', 'status'],
            filters: [
                ['status', '=', 'Open'],
                ['allocated_to', 'is', 'set'],
            ],
            or_filters: [['priority', '=', 'High']],
            order_by: 'priority desc, modified asc',
            group_by: 'status',
            limit_start: 100,
            limit_page_length: 50,
        })
    })

    it('sends `parent` for child table rows, and keeps the rows to that parent type', async () => {
        const { frappe, requests } = client([json(200, { data: [] })])
        await frappe.doc.list('Has Role', { fields: ['role'], parent: 'User' })
        expect(pathOf(only(requests))).toBe('/api/resource/Has%20Role')
        expect(queryOf(only(requests))).toMatchObject({ filters: [['parenttype', '=', 'User']], parent: 'User' })
    })

    it.each(awkwardNames)('encodes a DocType with %s', async (_title, doctype, encoded) => {
        const { frappe, requests } = client([json(200, { data: [] })])
        await frappe.doc.list(doctype)
        expect(pathOf(only(requests))).toBe(`/api/resource/${encoded}`)
    })

    it.each([
        ['an empty doctype', '', {}],
        ['a bad limit', 'ToDo', { limit: 0 }],
        ['a bad sort field', 'ToDo', { orderBy: { field: 'name; --' } }],
        ['fields that are not an array', 'ToDo', { fields: 'name' }],
        ['an empty parent', 'ToDo', { parent: '' }],
        ['a parent that is not a string', 'ToDo', { parent: 1 }],
        ['null arguments', 'ToDo', null],
        ['arguments that are not an object', 'ToDo', 'status'],
    ])('rejects %s without sending', async (_title, doctype, args) => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.list(doctype, args as never)).rejects.toBeInstanceOf(ConfigurationError)
        expect(requests).toHaveLength(0)
    })

    it('rejects a response without a list in `data`', async () => {
        const { frappe } = client([json(200, { data: { name: 'x' } })])
        await expect(frappe.doc.list('ToDo')).rejects.toMatchObject({
            name: 'FrappeError',
            message: `Expected a list in \`data\` from GET ${url}/api/resource/ToDo.`,
            status: 200,
        })
    })

    describe('a query too long for a URL', () => {
        /** Names for an `in` filter whose GET path and query come to exactly `length` characters. */
        function namesOfLength(length: number): string[] {
            const encoded = (names: string[]) =>
                `/api/resource/ToDo?${new URLSearchParams({
                    filters: JSON.stringify([['name', 'in', names]]),
                    limit_start: '0',
                    limit_page_length: '20',
                }).toString()}`.length
            const names = Array.from({ length: 200 }, (_, index) => `TODO-${String(index).padStart(5, '0')}`)
            while (encoded(names) > length) names.pop()
            names.push('x'.repeat(length - encoded([...names, ''])))
            expect(encoded(names)).toBe(length)
            return names
        }

        it('is sent as a GET at exactly 3800 characters', async () => {
            const { frappe, requests } = client([json(200, { data: [] })])
            await frappe.doc.list('ToDo', { filters: { name: ['in', namesOfLength(3800)] } })
            const request = only(requests)
            expect(request.method).toBe('GET')
            expect(request.url.slice(url.length)).toHaveLength(3800)
        })

        it('is sent as a POST to frappe.client.get_list at 3801, and returns `message`', async () => {
            const names = namesOfLength(3801)
            const rows = [{ name: 'TODO-00001' }]
            const { frappe, requests } = client([json(200, { message: rows })])
            await expect(
                frappe.doc.list('ToDo', { fields: ['name'], filters: { name: ['in', names] }, limit: 500 }),
            ).resolves.toEqual(rows)
            const request = only(requests)
            expect(request.method).toBe('POST')
            expect(request.url).toBe(`${url}/api/method/frappe.client.get_list`)
            expect(request.headers.get('content-type')).toBe('application/json')
            expect(await request.json()).toEqual({
                doctype: 'ToDo',
                fields: ['name'],
                filters: [['name', 'in', names]],
                limit_start: 0,
                limit_page_length: 500,
            })
        })

        it('rejects a POST response without a list in `message`', async () => {
            const { frappe } = client([json(200, { message: 3 })])
            await expect(
                frappe.doc.list('ToDo', { filters: { name: ['in', namesOfLength(3801)] } }),
            ).rejects.toMatchObject({
                name: 'FrappeError',
                message: `Expected a list in \`message\` from POST ${url}/api/method/frappe.client.get_list.`,
                status: 200,
            })
        })
    })
})

describe('doc.count', () => {
    it('reads frappe.client.get_count and returns `message`', async () => {
        const { frappe, requests } = client([json(200, { message: 7 })])
        await expect(frappe.doc.count('ToDo', { status: 'Open' })).resolves.toBe(7)
        const request = only(requests)
        expect(request.method).toBe('GET')
        expect(pathOf(request)).toBe('/api/method/frappe.client.get_count')
        expect(queryOf(request)).toEqual({ doctype: 'ToDo', filters: [['status', '=', 'Open']] })
    })

    it('counts every document without filters', async () => {
        const { frappe, requests } = client([json(200, { message: 0 })])
        await expect(frappe.doc.count('Sales Invoice')).resolves.toBe(0)
        expect(queryOf(only(requests))).toEqual({ doctype: 'Sales Invoice' })
    })

    it('is sent as a POST when the filters are too long for a URL', async () => {
        const names = Array.from({ length: 400 }, (_, index) => `TODO-${String(index).padStart(5, '0')}`)
        const { frappe, requests } = client([json(200, { message: 400 })])
        await expect(frappe.doc.count('ToDo', { name: ['in', names] })).resolves.toBe(400)
        const request = only(requests)
        expect(request.method).toBe('POST')
        expect(request.url).toBe(`${url}/api/method/frappe.client.get_count`)
        expect(await request.json()).toEqual({ doctype: 'ToDo', filters: [['name', 'in', names]] })
    })

    it('rejects invalid arguments without sending', async () => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.count('')).rejects.toBeInstanceOf(ConfigurationError)
        await expect(frappe.doc.count('ToDo', 'status' as never)).rejects.toBeInstanceOf(ConfigurationError)
        expect(requests).toHaveLength(0)
    })

    it('rejects a response without a number in `message`', async () => {
        const { frappe } = client([json(200, { message: '7' })])
        await expect(frappe.doc.count('ToDo')).rejects.toMatchObject({
            name: 'FrappeError',
            message: `Expected a number in \`message\` from GET ${url}/api/method/frappe.client.get_count.`,
            status: 200,
        })
    })
})

describe('doc.paginate', () => {
    const noName = 'paginate() cannot continue: the last row of a page of ToDo has no `name`.'
    const page = (...names: (string | number)[]) => json(200, { data: names.map((name) => ({ name })) })

    async function all<T>(rows: AsyncIterable<T>): Promise<T[]> {
        const found: T[] = []
        for await (const row of rows) found.push(row)
        return found
    }

    it('walks the rows in name order, continuing after the last name of each page', async () => {
        const { frappe, requests } = client([page('A', 'B'), page('C', 'D'), page('E')])
        const rows = await all(frappe.doc.paginate('ToDo', { filters: { status: 'Open' }, pageSize: 2 }))
        expect(rows).toEqual([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }])
        expect(requests.map(queryOf)).toEqual([
            { filters: [['status', '=', 'Open']], order_by: 'name asc', limit_start: 0, limit_page_length: 2 },
            {
                filters: [
                    ['status', '=', 'Open'],
                    ['name', '>', 'B'],
                ],
                order_by: 'name asc',
                limit_start: 0,
                limit_page_length: 2,
            },
            {
                filters: [
                    ['status', '=', 'Open'],
                    ['name', '>', 'D'],
                ],
                order_by: 'name asc',
                limit_start: 0,
                limit_page_length: 2,
            },
        ])
    })

    it('reads 100 rows per request by default', async () => {
        const { frappe, requests } = client([page()])
        await all(frappe.doc.paginate('ToDo'))
        expect(queryOf(only(requests))).toEqual({ order_by: 'name asc', limit_start: 0, limit_page_length: 100 })
    })

    it('stops after an empty page', async () => {
        const { frappe, requests } = client([page('A', 'B'), page()])
        expect(await all(frappe.doc.paginate('ToDo', { pageSize: 2 }))).toHaveLength(2)
        expect(requests).toHaveLength(2)
    })

    it('reuses a numeric name as a number', async () => {
        const { frappe, requests } = client([page(1, 2), page(3)])
        await all(frappe.doc.paginate('Access Log', { pageSize: 2 }))
        expect(requests.map(queryOf)[1]).toMatchObject({ filters: [['name', '>', 2]] })
    })

    it.each([
        ['missing', ['subject'], ['subject', 'name']],
        ['already there', ['name', 'subject'], ['name', 'subject']],
        ['`*`, which includes it', ['*'], ['*']],
    ])('asks for name when it is %s', async (_title, fields, sent) => {
        const { frappe, requests } = client([page()])
        await all(frappe.doc.paginate('ToDo', { fields: fields as never }))
        expect(queryOf(only(requests))['fields']).toEqual(sent)
    })

    it('passes orFilters and parent through to every page', async () => {
        const { frappe, requests } = client([page('A'), page()])
        await all(
            frappe.doc.paginate('Has Role', {
                orFilters: [['role', '=', 'System Manager']],
                parent: 'User',
                pageSize: 1,
            }),
        )
        for (const request of requests) {
            expect(queryOf(request)).toMatchObject({ or_filters: [['role', '=', 'System Manager']], parent: 'User' })
        }
        expect(requests.map((request) => queryOf(request)['filters'])).toEqual([
            [['parenttype', '=', 'User']],
            [
                ['parenttype', '=', 'User'],
                ['name', '>', 'A'],
            ],
        ])
        expect(requests).toHaveLength(2)
    })

    it('uses the options for every request', async () => {
        const { frappe, requests } = client([page('A'), page()])
        await all(frappe.doc.paginate('ToDo', { pageSize: 1 }, { headers: { 'X-Trace': 'walk-1' } }))
        expect(requests.map((request) => request.headers.get('x-trace'))).toEqual(['walk-1', 'walk-1'])
    })

    it('ends with CancelledError when aborted between pages, without another request', async () => {
        const controller = new AbortController()
        const { frappe, requests } = client([page('A', 'B'), page('C')])
        const walk = frappe.doc.paginate('ToDo', { pageSize: 2 }, { signal: controller.signal })
        await expect(walk.next()).resolves.toEqual({ value: { name: 'A' }, done: false })
        await expect(walk.next()).resolves.toEqual({ value: { name: 'B' }, done: false })
        controller.abort()
        await expect(walk.next()).rejects.toBeInstanceOf(CancelledError)
        expect(requests).toHaveLength(1)
    })

    it('switches a page to POST when its filters are too long for a URL', async () => {
        const names = Array.from({ length: 400 }, (_, index) => `TODO-${String(index).padStart(5, '0')}`)
        const { frappe, requests } = client([json(200, { message: [{ name: 'TODO-00000' }] })])
        await all(frappe.doc.paginate('ToDo', { filters: { name: ['in', names] }, pageSize: 2 }))
        expect(only(requests).method).toBe('POST')
    })

    it.each(['orderBy', 'groupBy', 'limit', 'offset'])('rejects %s without sending', async (key) => {
        const { frappe, requests } = client([])
        await expect(all(frappe.doc.paginate('ToDo', { [key]: 1 }))).rejects.toThrow(
            new ConfigurationError(`paginate() sorts and pages by \`name\` itself; \`${key}\` is not accepted.`),
        )
        expect(requests).toHaveLength(0)
    })

    it.each([
        ['null', null],
        ['not an object', 'status'],
    ])('rejects arguments that are %s without sending', async (_title, args) => {
        const { frappe, requests } = client([])
        await expect(all(frappe.doc.paginate('ToDo', args as never))).rejects.toThrow(
            new ConfigurationError('The listing arguments must be an object.'),
        )
        expect(requests).toHaveLength(0)
    })

    it('reads its arguments once, at the start of the walk', async () => {
        const { frappe, requests } = client([page('A'), page()])
        const fields = ['name', 'description']
        const orFilters = [['priority', '=', 'High']]
        const walk = frappe.doc.paginate('ToDo', { fields, orFilters: orFilters as never, pageSize: 1 })
        await walk.next()
        fields.push('status')
        orFilters.push(['priority', '=', 'Low'])
        await all(walk)
        expect(requests.map((request) => [queryOf(request)['fields'], queryOf(request)['or_filters']])).toEqual([
            [['name', 'description'], [['priority', '=', 'High']]],
            [['name', 'description'], [['priority', '=', 'High']]],
        ])
    })

    it.each([0, 2.5, '10'])('rejects the page size %s without sending', async (pageSize) => {
        const { frappe, requests } = client([])
        await expect(all(frappe.doc.paginate('ToDo', { pageSize: pageSize as number }))).rejects.toThrow(
            new ConfigurationError(`\`pageSize\` must be a positive integer; got ${String(pageSize)}.`),
        )
        expect(requests).toHaveLength(0)
    })

    it.each([
        [
            'repeats the page before',
            [page('A', 'B'), page('A', 'B')],
            'paginate() cannot continue: ToDo answered the same page twice, so its list ignores the filter on `name`.',
            [{ name: 'A' }, { name: 'B' }],
        ],
        ['has no name', [json(200, { data: [{ name: 'A' }, { subject: 'no name' }] })], noName, []],
        [
            'has a name that is not a string or a number',
            [json(200, { data: [{ name: 'A' }, { name: null }] })],
            noName,
            [],
        ],
        ['is not an object', [json(200, { data: [{ name: 'A' }, 'B'] })], noName, []],
    ])('fails before yielding a page whose last row %s', async (_title, replies, message, yielded) => {
        const { frappe } = client(replies)
        const found: unknown[] = []
        const walk = async () => {
            for await (const row of frappe.doc.paginate('ToDo', { pageSize: 2 })) found.push(row)
        }
        await expect(walk()).rejects.toThrow(new FrappeError(message))
        expect(found).toEqual(yielded)
    })
})

describe('doc', () => {
    it('is frozen, and its methods can be destructured', async () => {
        const { frappe } = client([json(200, { message: 1 })])
        expect(Object.isFrozen(frappe.doc)).toBe(true)
        const { count } = frappe.doc
        await expect(count('ToDo')).resolves.toBe(1)
    })
})
