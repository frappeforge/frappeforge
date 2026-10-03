import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
    ConflictError,
    createClient,
    InvalidArgumentError,
    NotFoundError,
    PermissionError,
    ValidationError,
} from '../../src/index.js'
import { json, only, type Reply, stubFetch } from '../support/fetch.js'

const url = 'https://example.com'
const resource = (path: string) => `${url}/api/resource/${path}`
const method = (name: string) => `${url}/api/method/frappe.client.${name}`

function client(replies: Reply[] = []) {
    const { fetch, requests } = stubFetch(replies)
    return { frappe: createClient({ url, fetch }), requests }
}

async function bodyOf(request: Request): Promise<unknown> {
    return JSON.parse(await request.text()) as unknown
}

/** A response recorded from a real Frappe site. */
function recorded(file: string): Response {
    const fixture = JSON.parse(readFileSync(new URL(`../fixtures/responses/${file}`, import.meta.url), 'utf8')) as {
        response: { status: number; headers: Record<string, string>; body: string }
    }
    return new Response(fixture.response.body, { status: fixture.response.status, headers: fixture.response.headers })
}

const doc = { doctype: 'ToDo', name: 'TODO-0001', status: 'Open', docstatus: 0 }

const NAME_ERROR = '`name` must be a non-empty string or a positive integer.'

/** Invalid document names, each rejected before any request. */
const badNames = [
    ['an empty name', ''],
    ['a boolean', true],
    ['null', null],
    ['0', 0],
    ['a fraction', 1.5],
] as const

/** Values that are not a plain object of fields. */
const notObjects = [
    ['null', null],
    ['an array', [{ status: 'Open' }]],
    ['a string', 'status=Open'],
    ['a number', 1],
    ['a Date', new Date(0)],
    ['FormData', new FormData()],
] as const

/** Each write method, called with a DocType and a name. */
const byName = [
    [
        'setValue',
        (frappe: ReturnType<typeof client>['frappe'], doctype: unknown, name: unknown) =>
            frappe.doc.setValue(doctype as string, name as string, { status: 'Open' }),
    ],
    [
        'rename',
        (frappe: ReturnType<typeof client>['frappe'], doctype: unknown, name: unknown) =>
            frappe.doc.rename(doctype as string, name as string, 'NEW'),
    ],
    [
        'delete',
        (frappe: ReturnType<typeof client>['frappe'], doctype: unknown, name: unknown) =>
            frappe.doc.delete(doctype as string, name as string),
    ],
    [
        'submit',
        (frappe: ReturnType<typeof client>['frappe'], doctype: unknown, name: unknown) =>
            frappe.doc.submit(doctype as string, name as string),
    ],
    [
        'cancel',
        (frappe: ReturnType<typeof client>['frappe'], doctype: unknown, name: unknown) =>
            frappe.doc.cancel(doctype as string, name as string),
    ],
    [
        'runMethod',
        (frappe: ReturnType<typeof client>['frappe'], doctype: unknown, name: unknown) =>
            frappe.doc.runMethod(doctype as string, name as string, 'submit'),
    ],
] as const

describe('doc.insert', () => {
    it('posts the fields to the DocType and returns the saved document', async () => {
        const { frappe, requests } = client([json(200, { data: doc })])
        await expect(frappe.doc.insert('ToDo', { description: 'Ship', priority: 'High' })).resolves.toEqual(doc)
        const request = only(requests)
        expect(request.method).toBe('POST')
        expect(request.url).toBe(resource('ToDo'))
        expect(await bodyOf(request)).toEqual({ data: { description: 'Ship', priority: 'High' } })
    })

    it('sends the fields under `data`, so a field named `data` stays a field', async () => {
        const { frappe, requests } = client([json(200, { data: doc })])
        await frappe.doc.insert('Version', { ref_doctype: 'ToDo', data: '{"changed": []}' })
        expect(await bodyOf(only(requests))).toEqual({ data: { ref_doctype: 'ToDo', data: '{"changed": []}' } })
    })

    it('sends child rows and booleans as they are', async () => {
        const { frappe, requests } = client([json(200, { data: doc })])
        const data = { title: 'Order', items: [{ item: 'A', qty: 1 }], is_urgent: true }
        await frappe.doc.insert('FF Order', data)
        const request = only(requests)
        expect(request.url).toBe(resource('FF%20Order'))
        expect(await bodyOf(request)).toEqual({ data })
    })

    it('accepts an empty document, for DocTypes whose fields all have defaults', async () => {
        const { frappe, requests } = client([json(200, { data: doc })])
        await frappe.doc.insert('ToDo', {})
        expect(await bodyOf(only(requests))).toEqual({ data: {} })
    })

    it.each(notObjects)('rejects %s as the document, before any request', async (_title, data) => {
        const { frappe, requests } = client()
        await expect(frappe.doc.insert('ToDo', data as never)).rejects.toThrow(
            new InvalidArgumentError('`data` must be a plain object of fields.'),
        )
        expect(requests).toHaveLength(0)
    })

    it('rejects an empty DocType before any request', async () => {
        const { frappe, requests } = client()
        await expect(frappe.doc.insert('', {})).rejects.toThrow(InvalidArgumentError)
        expect(requests).toHaveLength(0)
    })

    it('reports a missing mandatory field as a ValidationError, as Frappe 16 answers it', async () => {
        const { frappe } = client([recorded('v16/mandatory.json')])
        const error = await frappe.doc.insert('ToDo', {}).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(ValidationError)
        expect(error).toMatchObject({ status: 417, exceptionType: 'MandatoryError' })
    })

    it('reports a name already in use as a ConflictError, as Frappe 15 answers it', async () => {
        const { frappe } = client([recorded('v15/duplicate.json')])
        const error = await frappe.doc.insert('Role', { name: 'System Manager' }).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(ConflictError)
        expect(error).toMatchObject({ status: 409, exceptionType: 'DuplicateEntryError' })
    })

    it('rejects an answer without a document', async () => {
        const { frappe } = client([json(200, { message: 'ok' })])
        await expect(frappe.doc.insert('ToDo', {})).rejects.toThrow(
            expect.objectContaining({
                name: 'FrappeError',
                message: `Expected a document in \`data\` from POST ${resource('ToDo')}.`,
            }),
        )
    })
})

describe('doc.insertMany', () => {
    it('posts every document with its DocType to insert_many and returns the names', async () => {
        const { frappe, requests } = client([json(200, { message: ['TODO-0001', 'TODO-0002'] })])
        await expect(
            frappe.doc.insertMany('ToDo', [{ description: 'One' }, { description: 'Two', doctype: 'Note' }]),
        ).resolves.toEqual(['TODO-0001', 'TODO-0002'])
        const request = only(requests)
        expect(request.method).toBe('POST')
        expect(request.url).toBe(method('insert_many'))
        expect(await bodyOf(request)).toEqual({
            docs: [
                { description: 'One', doctype: 'ToDo' },
                { description: 'Two', doctype: 'ToDo' },
            ],
        })
    })

    it('returns numeric names, as Frappe answers them for "Autoincrement" DocTypes', async () => {
        const { frappe } = client([json(200, { message: [7, 8] })])
        await expect(frappe.doc.insertMany('FF Counter', [{}, {}])).resolves.toEqual([7, 8])
    })

    it.each([
        ['an empty array', []],
        ['an object', { description: 'One' }],
        ['null', null],
    ])('rejects %s as the documents, before any request', async (_title, docs) => {
        const { frappe, requests } = client()
        await expect(frappe.doc.insertMany('ToDo', docs as never)).rejects.toThrow(
            new InvalidArgumentError('`docs` must be a non-empty array of documents.'),
        )
        expect(requests).toHaveLength(0)
    })

    it.each(notObjects)('rejects %s as one of the documents, before any request', async (_title, entry) => {
        const { frappe, requests } = client()
        await expect(frappe.doc.insertMany('ToDo', [{}, entry as never])).rejects.toThrow(
            new InvalidArgumentError('Each document must be a plain object of fields.'),
        )
        expect(requests).toHaveLength(0)
    })

    it('rejects an empty DocType before any request', async () => {
        const { frappe, requests } = client()
        await expect(frappe.doc.insertMany('', [{}])).rejects.toThrow(InvalidArgumentError)
        expect(requests).toHaveLength(0)
    })

    it.each([
        ['not a list', { message: 'TODO-0001' }],
        ['a list holding something other than names', { message: ['TODO-0001', null] }],
        ['no `message`', {}],
    ])('rejects an answer that is %s', async (_title, body) => {
        const { frappe } = client([json(200, body)])
        await expect(frappe.doc.insertMany('ToDo', [{}])).rejects.toThrow(
            expect.objectContaining({
                name: 'FrappeError',
                message: `Expected a list of names in \`message\` from POST ${method('insert_many')}.`,
            }),
        )
    })

    it("passes Frappe's limit of 200 documents through as a ValidationError", async () => {
        const { frappe } = client([
            json(417, { exc_type: 'ValidationError', _error_message: 'Only 200 inserts allowed in one request' }),
        ])
        await expect(
            frappe.doc.insertMany(
                'ToDo',
                Array.from({ length: 201 }, () => ({})),
            ),
        ).rejects.toThrow(ValidationError)
    })
})

describe('doc.setValue', () => {
    it('puts the values to the document and returns it as saved', async () => {
        const { frappe, requests } = client([json(200, { data: { ...doc, status: 'Closed' } })])
        await expect(frappe.doc.setValue('ToDo', 'TODO-0001', { status: 'Closed' })).resolves.toEqual({
            ...doc,
            status: 'Closed',
        })
        const request = only(requests)
        expect(request.method).toBe('PUT')
        expect(request.url).toBe(resource('ToDo/TODO-0001'))
        expect(await bodyOf(request)).toEqual({ data: { status: 'Closed' } })
    })

    it.each([
        ['a name with reserved characters', 'A/B #1?', 'A%2FB%20%231%3F'],
        ['a numeric name', 5, '5'],
    ])('encodes %s in the path', async (_title, name, encoded) => {
        const { frappe, requests } = client([json(200, { data: doc })])
        await frappe.doc.setValue('Sales Invoice', name, { remarks: 'x' })
        expect(only(requests).url).toBe(resource(`Sales%20Invoice/${encoded}`))
    })

    it('sends a child table as it is: the table replaces the stored one', async () => {
        const { frappe, requests } = client([json(200, { data: doc })])
        const items = [
            { name: 'row-a', item: 'A', qty: 2, note: 'kept' },
            { item: 'C', qty: 1 },
        ]
        await frappe.doc.setValue('FF Order', 'ORD-1', { items })
        expect(await bodyOf(only(requests))).toEqual({ data: { items } })
    })

    it.each([
        ['an empty object', {}],
        ['only undefined values', { status: undefined }],
        ['only its own `name`', { name: 'TODO-0001' }],
        ['only its `doctype`', { doctype: 'ToDo' }],
    ])('rejects %s before any request: there is nothing to save', async (_title, values) => {
        const { frappe, requests } = client()
        await expect(frappe.doc.setValue('ToDo', 'TODO-0001', values as never)).rejects.toThrow(
            new InvalidArgumentError('`values` must set at least one field.'),
        )
        expect(requests).toHaveLength(0)
    })

    it.each(notObjects)('rejects %s as the values, before any request', async (_title, values) => {
        const { frappe, requests } = client()
        await expect(frappe.doc.setValue('ToDo', 'TODO-0001', values as never)).rejects.toThrow(
            new InvalidArgumentError('`values` must be a plain object of fields.'),
        )
        expect(requests).toHaveLength(0)
    })

    it('sends the defined values and leaves undefined ones out', async () => {
        const { frappe, requests } = client([json(200, { data: doc })])
        await frappe.doc.setValue('ToDo', 'TODO-0001', { status: 'Closed', priority: undefined })
        expect(await bodyOf(only(requests))).toEqual({ data: { status: 'Closed' } })
    })

    it('sends a field named `data` as a field', async () => {
        const { frappe, requests } = client([json(200, { data: doc })])
        await frappe.doc.setValue('Version', 'VER-1', { data: '42' })
        expect(await bodyOf(only(requests))).toEqual({ data: { data: '42' } })
    })

    it.each([
        ['another name', 'TODO-0002'],
        ['a number that is another name', 6],
        ['an object', { name: 'TODO-0001' }],
        ['null', null],
    ])('rejects %s in `values.name` before any request: it would save another document', async (_title, name) => {
        const { frappe, requests } = client()
        await expect(frappe.doc.setValue('ToDo', 'TODO-0001', { name, status: 'Closed' })).rejects.toThrow(
            new InvalidArgumentError("`values.name` must be the document's own name; use `rename` to change it."),
        )
        expect(requests).toHaveLength(0)
    })

    it.each([
        ['the same name', 'TODO-0001', 'TODO-0001'],
        ['the same numeric name, as a number', 5, 5],
        ['the same numeric name, as a string', '5', 5],
        ['the same numeric name, given as a string', 5, '5'],
    ])('sends %s in `values.name`, so a whole document can be sent back', async (_title, target, name) => {
        const { frappe, requests } = client([json(200, { data: doc })])
        const values = { ...doc, name: target, modified: '2026-01-01 00:00:00' }
        await frappe.doc.setValue('ToDo', name, values)
        expect(await bodyOf(only(requests))).toEqual({ data: values })
    })

    it('rejects an answer without a document', async () => {
        const { frappe } = client([json(200, {})])
        await expect(frappe.doc.setValue('ToDo', 'TODO-0001', { status: 'Closed' })).rejects.toThrow(
            expect.objectContaining({
                name: 'FrappeError',
                message: `Expected a document in \`data\` from PUT ${resource('ToDo/TODO-0001')}.`,
            }),
        )
    })

    it('passes a document saved in between through as a ValidationError', async () => {
        const { frappe } = client([json(417, { exc_type: 'TimestampMismatchError' })])
        const error = await frappe.doc
            .setValue('ToDo', 'TODO-0001', { ...doc, modified: '2026-01-01 00:00:00' })
            .catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(ValidationError)
        expect(error).toMatchObject({ exceptionType: 'TimestampMismatchError' })
    })
})

describe('doc.rename', () => {
    it('posts the old and new names to rename_doc and returns the stored name', async () => {
        const { frappe, requests } = client([json(200, { message: 'ACME Corp' })])
        await expect(frappe.doc.rename('Customer', 'ACME', 'ACME Corp')).resolves.toBe('ACME Corp')
        const request = only(requests)
        expect(request.method).toBe('POST')
        expect(request.url).toBe(method('rename_doc'))
        expect(await bodyOf(request)).toEqual({
            doctype: 'Customer',
            old_name: 'ACME',
            new_name: 'ACME Corp',
            merge: false,
        })
    })

    it('sends merge, and numeric names as strings', async () => {
        const { frappe, requests } = client([json(200, { message: 8 })])
        await expect(frappe.doc.rename('FF Counter', 7, 8, { merge: true })).resolves.toBe(8)
        expect(await bodyOf(only(requests))).toEqual({
            doctype: 'FF Counter',
            old_name: '7',
            new_name: '8',
            merge: true,
        })
    })

    it('rejects an invalid new name before any request', async () => {
        const { frappe, requests } = client()
        await expect(frappe.doc.rename('Customer', 'ACME', '')).rejects.toThrow(
            new InvalidArgumentError('`newName` must be a non-empty string or a positive integer.'),
        )
        expect(requests).toHaveLength(0)
    })

    it('rejects a merge that is not a boolean before any request', async () => {
        const { frappe, requests } = client()
        await expect(frappe.doc.rename('Customer', 'ACME', 'B', { merge: 'yes' as never })).rejects.toThrow(
            new InvalidArgumentError('`merge` must be a boolean.'),
        )
        expect(requests).toHaveLength(0)
    })

    it('does not send merge as a request option', async () => {
        const { frappe, requests } = client([json(200, { message: 'B' })])
        await frappe.doc.rename('Customer', 'ACME', 'B', { merge: false, headers: { 'X-Trace': '1' } })
        const request = only(requests)
        expect(request.headers.get('x-trace')).toBe('1')
        expect(request.headers.has('merge')).toBe(false)
    })

    it.each([
        ['not a name', { message: true }],
        ['missing', {}],
    ])('rejects an answer that is %s', async (_title, body) => {
        const { frappe } = client([json(200, body)])
        await expect(frappe.doc.rename('Customer', 'ACME', 'B')).rejects.toThrow(
            expect.objectContaining({
                name: 'FrappeError',
                message: `Expected a name in \`message\` from POST ${method('rename_doc')}.`,
            }),
        )
    })
})

describe('doc.delete', () => {
    it('deletes the document and resolves undefined', async () => {
        const { frappe, requests } = client([json(202, { message: 'ok' })])
        await expect(frappe.doc.delete('ToDo', 'TODO-0001')).resolves.toBeUndefined()
        const request = only(requests)
        expect(request.method).toBe('DELETE')
        expect(request.url).toBe(resource('ToDo/TODO-0001'))
        expect(request.body).toBeNull()
    })

    it('deletes by a numeric name', async () => {
        const { frappe, requests } = client([json(202, { message: 'ok' })])
        await frappe.doc.delete('FF Counter', 7)
        expect(only(requests).url).toBe(resource('FF%20Counter/7'))
    })

    it('passes a missing document through as a NotFoundError', async () => {
        const { frappe } = client([recorded('v16/not-found.json')])
        await expect(frappe.doc.delete('ToDo', 'TODO-0001')).rejects.toThrow(NotFoundError)
    })
})

describe.each([
    ['submit', 1],
    ['cancel', 2],
] as const)('doc.%s', (action, docstatus) => {
    it(`puts docstatus ${String(docstatus)}, under \`data\`, and returns the document`, async () => {
        const { frappe, requests } = client([json(200, { data: { ...doc, docstatus } })])
        await expect(frappe.doc[action]('Sales Invoice', 'SINV-0001')).resolves.toEqual({ ...doc, docstatus })
        const request = only(requests)
        expect(request.method).toBe('PUT')
        expect(request.url).toBe(resource('Sales%20Invoice/SINV-0001'))
        expect(await bodyOf(request)).toEqual({ data: { docstatus } })
    })

    it('takes a numeric name', async () => {
        const { frappe, requests } = client([json(200, { data: doc })])
        await frappe.doc[action]('FF Counter', 7)
        expect(only(requests).url).toBe(resource('FF%20Counter/7'))
    })

    it('passes a missing permission through as a PermissionError', async () => {
        const { frappe } = client([json(403, { exc_type: 'PermissionError' })])
        await expect(frappe.doc[action]('Sales Invoice', 'SINV-0001')).rejects.toThrow(PermissionError)
    })

    it('rejects an answer without a document', async () => {
        const { frappe } = client([json(200, { data: null })])
        await expect(frappe.doc[action]('Sales Invoice', 'SINV-0001')).rejects.toThrow(
            expect.objectContaining({
                name: 'FrappeError',
                message: `Expected a document in \`data\` from PUT ${resource('Sales%20Invoice/SINV-0001')}.`,
            }),
        )
    })
})

describe('doc.runMethod', () => {
    it('posts `run_method` and the arguments to the document, and returns `data`', async () => {
        const { frappe, requests } = client([json(200, { data: { name: 'COMM-0001' } })])
        await expect(
            frappe.doc.runMethod('Sales Order', 'SO/0001', 'add_comment', { comment_type: 'Comment', text: 'Checked' }),
        ).resolves.toEqual({ name: 'COMM-0001' })
        const request = only(requests)
        expect(request.method).toBe('POST')
        expect(request.url).toBe(resource('Sales%20Order/SO%2F0001'))
        expect(await bodyOf(request)).toEqual({ run_method: 'add_comment', comment_type: 'Comment', text: 'Checked' })
    })

    it('sends `data` as an ordinary argument', async () => {
        const { frappe, requests } = client([json(200, {})])
        await frappe.doc.runMethod('Sales Order', 'SO-0001', 'recalculate', { data: { qty: 2 } })
        // Frappe passes the body's keys to the method as they are, not through `data`.
        expect(await bodyOf(only(requests))).toEqual({ run_method: 'recalculate', data: { qty: 2 } })
    })

    it('sends only `run_method` without arguments, and resolves undefined when the method returned nothing', async () => {
        const { frappe, requests } = client([json(200, {})])
        await expect(frappe.doc.runMethod('Sales Order', 'SO-0001', 'submit')).resolves.toBeUndefined()
        expect(await bodyOf(only(requests))).toEqual({ run_method: 'submit' })
    })

    it('takes a numeric name', async () => {
        const { frappe, requests } = client([json(200, { data: 1 })])
        await expect(frappe.doc.runMethod('FF Counter', 7, 'bump')).resolves.toBe(1)
        expect(only(requests).url).toBe(resource('FF%20Counter/7'))
    })

    it('passes a method that is not whitelisted through as a PermissionError', async () => {
        const { frappe } = client([json(403, { exc_type: 'PermissionError' })])
        await expect(frappe.doc.runMethod('ToDo', 'TODO-0001', 'validate')).rejects.toThrow(PermissionError)
    })

    it.each([
        ['an empty name', ''],
        ['a dotted path', 'frappe.ping'],
        ['a hyphenated name', 'add-comment'],
        ['a name starting with a digit', '1st'],
        ['a number', 1],
    ])('rejects %s as the method, before any request', async (_title, methodName) => {
        const { frappe, requests } = client()
        await expect(frappe.doc.runMethod('ToDo', 'TODO-0001', methodName as string)).rejects.toThrow(
            new InvalidArgumentError('`method` must be the name of a method, such as "add_comment".'),
        )
        expect(requests).toHaveLength(0)
    })

    it.each(notObjects)('rejects %s as the arguments, before any request', async (_title, args) => {
        const { frappe, requests } = client()
        await expect(
            frappe.doc.runMethod('ToDo', 'TODO-0001', 'submit', args as unknown as Record<string, unknown>),
        ).rejects.toThrow(new InvalidArgumentError('`args` must be a plain object of arguments.'))
        expect(requests).toHaveLength(0)
    })

    it('rejects a `run_method` argument, before any request', async () => {
        const { frappe, requests } = client()
        await expect(frappe.doc.runMethod('ToDo', 'TODO-0001', 'submit', { run_method: 'cancel' })).rejects.toThrow(
            new InvalidArgumentError('`args` cannot contain `run_method`: pass the method as `method`.'),
        )
        expect(requests).toHaveLength(0)
    })
})

describe.each(byName)('doc.%s checks its arguments', (_method, call) => {
    it.each(badNames)('rejects %s as the name, before any request', async (_title, name) => {
        const { frappe, requests } = client()
        await expect(call(frappe, 'ToDo', name)).rejects.toThrow(new InvalidArgumentError(NAME_ERROR))
        expect(requests).toHaveLength(0)
    })

    it('rejects an empty DocType before any request', async () => {
        const { frappe, requests } = client()
        await expect(call(frappe, '', 'TODO-0001')).rejects.toThrow(
            new InvalidArgumentError('`doctype` must be a non-empty string.'),
        )
        expect(requests).toHaveLength(0)
    })
})
