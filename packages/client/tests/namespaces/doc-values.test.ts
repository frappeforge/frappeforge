import { describe, expect, it } from 'vitest'

import { createClient, InvalidArgumentError, NotFoundError, PermissionError, ValidationError } from '../../src/index.js'
import { json, only, type Reply, stubFetch } from '../support/fetch.js'

const url = 'https://example.com'
const method = (name: string) => `${url}/api/method/frappe.client.${name}`

function client(replies: Reply[]) {
    const { fetch, requests } = stubFetch(replies)
    return { frappe: createClient({ url, fetch }), requests }
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

const NAME_ERROR = '`name` must be a non-empty string or a positive integer.'

/** Invalid document names, each rejected before any request. */
const badNames = [
    ['an empty name', ''],
    ['a boolean', true],
    ['null', null],
    ['0', 0],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['a number above the safe integers', 2 ** 53],
] as const

describe('doc.getValue', () => {
    it('reads one field of a document by name, always asking for a list of fields', async () => {
        const { frappe, requests } = client([json(200, { message: { status: 'Open' } })])
        await expect(frappe.doc.getValue('ToDo', 'TODO-0001', 'status')).resolves.toBe('Open')
        const request = only(requests)
        expect(request.method).toBe('GET')
        expect(request.url.startsWith(method('get_value'))).toBe(true)
        expect(queryOf(request)).toEqual({
            doctype: 'ToDo',
            fieldname: ['status'],
            filters: [['name', '=', 'TODO-0001']],
        })
    })

    it.each([
        ['a name that is valid JSON', '123', '123'],
        ['the name true', 'true', 'true'],
        ['a numeric name, as a string', 5, '5'],
    ])('sends %s as a filter on `name`', async (_title, name, sent) => {
        const { frappe, requests } = client([json(200, { message: { name: sent } })])
        await frappe.doc.getValue('Counter', name, 'name')
        expect(queryOf(only(requests))['filters']).toEqual([['name', '=', sent]])
    })

    it('reads several fields as a row', async () => {
        const row = { status: 'Open', priority: 'High' }
        const { frappe, requests } = client([json(200, { message: row })])
        await expect(frappe.doc.getValue('ToDo', 'TODO-0001', ['status', 'priority'])).resolves.toEqual(row)
        expect(queryOf(only(requests))['fieldname']).toEqual(['status', 'priority'])
    })

    it('finds the document by filters, in object or tuple form', async () => {
        const { frappe, requests } = client([
            json(200, { message: { name: 'A' } }),
            json(200, { message: { name: 'B' } }),
        ])
        await expect(
            frappe.doc.getValue('ToDo', { status: 'Open', allocated_to: undefined } as never, 'name'),
        ).resolves.toBe('A')
        await expect(frappe.doc.getValue('ToDo', [['priority', '=', 'High']], 'name')).resolves.toBe('B')
        expect(requests.map((request) => queryOf(request)['filters'])).toEqual([
            [['status', '=', 'Open']],
            [['priority', '=', 'High']],
        ])
    })

    it.each([
        ['an empty object', {}],
        ['no `message`', undefined],
    ])('is null when no document matches: %s', async (_title, message) => {
        const { frappe } = client([json(200, message === undefined ? {} : { message })])
        await expect(frappe.doc.getValue('ToDo', 'nope', 'status')).resolves.toBeNull()
        const again = client([json(200, message === undefined ? {} : { message })])
        await expect(again.frappe.doc.getValue('ToDo', 'nope', ['status'])).resolves.toBeNull()
    })

    it.each([
        ['null', { reference_name: null, name: 'TODO-0001' }],
        ['absent', { name: 'TODO-0001' }],
    ])('is null for a field that is %s', async (_title, message) => {
        const { frappe } = client([json(200, { message })])
        await expect(frappe.doc.getValue('ToDo', 'TODO-0001', 'reference_name')).resolves.toBeNull()
    })

    it('reads a child table row with `parent`, the parent DocType, and only that DocType’s rows', async () => {
        const { frappe, requests } = client([json(200, { message: { role: 'System Manager' } })])
        await expect(
            frappe.doc.getValue('Has Role', { parent: 'user@example.com' }, 'role', {
                parent: 'User',
                headers: { 'X-Test': 'yes' },
            }),
        ).resolves.toBe('System Manager')
        const request = only(requests)
        expect(queryOf(request)).toEqual({
            doctype: 'Has Role',
            fieldname: ['role'],
            filters: [
                ['parent', '=', 'user@example.com'],
                ['parenttype', '=', 'User'],
            ],
            parent: 'User',
        })
        expect(request.headers.get('X-Test')).toBe('yes')
    })

    it.each([
        ['an empty string', ''],
        ['a number', 5],
    ])('rejects %s as `parent` without sending', async (_title, parent) => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.getValue('Has Role', 'X', 'role', { parent: parent as never })).rejects.toThrow(
            new InvalidArgumentError('`parent` must be the name of the parent DocType.'),
        )
        expect(requests).toHaveLength(0)
    })

    describe('a query too long for a URL', () => {
        /** Names for an `in` filter whose GET path and query come to exactly `length` characters. */
        function namesOfLength(length: number): string[] {
            const encoded = (names: string[]) =>
                `/api/method/frappe.client.get_value?${new URLSearchParams({
                    doctype: 'ToDo',
                    fieldname: JSON.stringify(['name']),
                    filters: JSON.stringify([['name', 'in', names]]),
                }).toString()}`.length
            const names = Array.from({ length: 200 }, (_, index) => `TODO-${String(index).padStart(5, '0')}`)
            while (encoded(names) > length) names.pop()
            names.push('x'.repeat(length - encoded([...names, ''])))
            expect(encoded(names)).toBe(length)
            return names
        }

        it('is sent as a GET at exactly 3800 characters', async () => {
            const { frappe, requests } = client([json(200, { message: {} })])
            await frappe.doc.getValue('ToDo', { name: ['in', namesOfLength(3800)] }, 'name')
            const request = only(requests)
            expect(request.method).toBe('GET')
            expect(request.url.slice(url.length)).toHaveLength(3800)
        })

        it('is sent as a POST at 3801, with the same parameters', async () => {
            const names = namesOfLength(3801)
            const { frappe, requests } = client([json(200, { message: { name: 'TODO-00001' } })])
            await expect(frappe.doc.getValue('ToDo', { name: ['in', names] }, 'name')).resolves.toBe('TODO-00001')
            const request = only(requests)
            expect(request.method).toBe('POST')
            expect(request.url).toBe(method('get_value'))
            expect(await request.json()).toEqual({
                doctype: 'ToDo',
                fieldname: ['name'],
                filters: [['name', 'in', names]],
            })
        })
    })

    it.each([
        ['an empty doctype', '', 'X', 'status', '`doctype` must be a non-empty string.'],
        ['empty object filters', 'ToDo', {}, 'status', 'The name or filters must not be empty.'],
        ['empty tuple filters', 'ToDo', [], 'status', 'The name or filters must not be empty.'],
        [
            'filters of only undefined values',
            'ToDo',
            { status: undefined },
            'status',
            'The name or filters must not be empty.',
        ],
        ['an empty list of fields', 'ToDo', 'X', [], '`fields` must name at least one field.'],
        ['the field *', 'ToDo', 'X', '*', '`fields` must be a field name such as "modified"; got *.'],
        [
            'a field that is not a column name',
            'ToDo',
            'X',
            ['a b'],
            'Each field must be a field name such as "modified"; got a b.',
        ],
        ['a field that is not a string', 'ToDo', 'X', 7, '`fields` must be a field name such as "modified"; got 7.'],
    ])('rejects %s without sending', async (_title, doctype, nameOrFilters, fields, message) => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.getValue(doctype, nameOrFilters as never, fields as never)).rejects.toThrow(
            new InvalidArgumentError(message),
        )
        expect(requests).toHaveLength(0)
    })

    it.each(badNames.filter(([, name]) => typeof name !== 'boolean' && name !== null))(
        'rejects %s as a name without sending',
        async (_title, name) => {
            const { frappe, requests } = client([])
            await expect(frappe.doc.getValue('ToDo', name as never, 'status')).rejects.toThrow(
                new InvalidArgumentError(NAME_ERROR),
            )
            expect(requests).toHaveLength(0)
        },
    )

    it.each([
        ['a boolean', true],
        ['null', null],
        ['a list that is not of tuples', ['status']],
    ])('rejects %s as the name or filters without sending', async (_title, nameOrFilters) => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.getValue('ToDo', nameOrFilters as never, 'status')).rejects.toThrow(
            new InvalidArgumentError(
                'The name or filters must be an object or an array of arrays such as ["status", "=", "Open"].',
            ),
        )
        expect(requests).toHaveLength(0)
    })

    it('rejects a `message` that is not an object', async () => {
        const { frappe } = client([json(200, { message: 'Open' })])
        await expect(frappe.doc.getValue('ToDo', 'TODO-0001', 'status')).rejects.toMatchObject({
            name: 'FrappeError',
            message: `Expected an object in \`message\` from GET ${method('get_value')}.`,
        })
    })

    it('rejects with the status error', async () => {
        const { frappe } = client([json(403, { exc_type: 'PermissionError' })])
        await expect(frappe.doc.getValue('ToDo', 'TODO-0001', 'status')).rejects.toBeInstanceOf(PermissionError)
    })
})

describe('doc.getSingleValue', () => {
    it('reads one field of a single DocType', async () => {
        const { frappe, requests } = client([json(200, { message: 60 })])
        await expect(frappe.doc.getSingleValue('System Settings', 'allow_login_after_fail')).resolves.toBe(60)
        const request = only(requests)
        expect(request.url.startsWith(method('get_single_value'))).toBe(true)
        expect(queryOf(request)).toEqual({ doctype: 'System Settings', field: 'allow_login_after_fail' })
    })

    it.each([
        ['no `message`', {}],
        ['a null `message`', { message: null }],
    ])('is null when Frappe sends no value: %s', async (_title, body) => {
        const { frappe } = client([json(200, body)])
        await expect(frappe.doc.getSingleValue('Website Settings', 'favicon')).resolves.toBeNull()
    })

    it.each([
        ['text', ''],
        ['a number', 0],
        ['a date', '0001-01-01'],
    ])('returns a value never set as Frappe casts it: %s', async (_title, message) => {
        const { frappe } = client([json(200, { message })])
        await expect(frappe.doc.getSingleValue('System Settings', 'country')).resolves.toBe(message)
    })

    it('rejects invalid arguments without sending', async () => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.getSingleValue('', 'country')).rejects.toBeInstanceOf(InvalidArgumentError)
        await expect(frappe.doc.getSingleValue('System Settings', '*' as never)).rejects.toThrow(
            new InvalidArgumentError('`field` must be a field name such as "modified"; got *.'),
        )
        expect(requests).toHaveLength(0)
    })
})

describe('doc.exists', () => {
    it('is true when a document matches, asking for its name alone', async () => {
        const { frappe, requests } = client([json(200, { message: { name: 'user@example.com' } })])
        await expect(frappe.doc.exists('User', 'user@example.com')).resolves.toBe(true)
        expect(queryOf(only(requests))).toEqual({
            doctype: 'User',
            fieldname: ['name'],
            filters: [['name', '=', 'user@example.com']],
        })
    })

    it('is false when none does', async () => {
        const { frappe } = client([json(200, { message: {} })])
        await expect(frappe.doc.exists('User', { enabled: 1 })).resolves.toBe(false)
    })

    it('checks a child table row with `parent`', async () => {
        const { frappe, requests } = client([json(200, { message: { name: 'a1b2c3' } })])
        await expect(
            frappe.doc.exists('Has Role', { parent: 'user@example.com', role: 'System Manager' }, { parent: 'User' }),
        ).resolves.toBe(true)
        expect(queryOf(only(requests))).toEqual({
            doctype: 'Has Role',
            fieldname: ['name'],
            filters: [
                ['parent', '=', 'user@example.com'],
                ['role', '=', 'System Manager'],
                ['parenttype', '=', 'User'],
            ],
            parent: 'User',
        })
    })

    it('rejects empty filters without sending', async () => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.exists('User', {})).rejects.toBeInstanceOf(InvalidArgumentError)
        expect(requests).toHaveLength(0)
    })
})

describe('doc.hasPermission', () => {
    it('checks read permission by default', async () => {
        const { frappe, requests } = client([json(200, { message: { has_permission: true } })])
        await expect(frappe.doc.hasPermission('ToDo', 'TODO-0001')).resolves.toBe(true)
        const request = only(requests)
        expect(request.url.startsWith(method('has_permission'))).toBe(true)
        expect(queryOf(request)).toEqual({ doctype: 'ToDo', docname: 'TODO-0001', perm_type: 'read' })
    })

    it('is false when Frappe answers false', async () => {
        const { frappe, requests } = client([json(200, { message: { has_permission: false } })])
        await expect(frappe.doc.hasPermission('ToDo', 5, 'submit')).resolves.toBe(false)
        const { searchParams } = new URL(only(requests).url)
        expect([searchParams.get('docname'), searchParams.get('perm_type')]).toEqual(['5', 'submit'])
    })

    it.each([
        ['a number', { has_permission: 1 }],
        ['a missing answer', {}],
    ])('rejects an answer that is not a boolean: %s', async (_title, message) => {
        const { frappe } = client([json(200, { message })])
        await expect(frappe.doc.hasPermission('ToDo', 'TODO-0001')).rejects.toMatchObject({
            name: 'FrappeError',
            message: `Expected a boolean \`has_permission\` in \`message\` from GET ${method('has_permission')}.`,
        })
    })

    it('rejects with NotFoundError for a document that does not exist', async () => {
        const { frappe } = client([json(404, { exc_type: 'DoesNotExistError' })])
        await expect(frappe.doc.hasPermission('ToDo', 'TODO-9999', 'write')).rejects.toBeInstanceOf(NotFoundError)
    })

    it.each([
        ['an unknown permission type', 'wirte'],
        ['an inherited property', 'toString'],
        ['a permission that is not a string', 1],
    ])('rejects %s without sending', async (_title, permission) => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.hasPermission('ToDo', 'TODO-0001', permission as never)).rejects.toThrow(
            new InvalidArgumentError(
                `\`permission\` must be one of select, read, write, create, delete, submit, cancel, amend, print, email, report, import, export, share; got ${String(permission)}.`,
            ),
        )
        expect(requests).toHaveLength(0)
    })

    it.each(badNames)('rejects %s as a name without sending', async (_title, name) => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.hasPermission('ToDo', name as never)).rejects.toThrow(
            new InvalidArgumentError(NAME_ERROR),
        )
        expect(requests).toHaveLength(0)
    })

    it('rejects a `message` that is not an object', async () => {
        const { frappe } = client([json(200, { message: true })])
        await expect(frappe.doc.hasPermission('ToDo', 'TODO-0001')).rejects.toMatchObject({ name: 'FrappeError' })
    })

    it('rejects an empty doctype without sending', async () => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.hasPermission('', 'X')).rejects.toBeInstanceOf(InvalidArgumentError)
        expect(requests).toHaveLength(0)
    })
})

describe('doc.validateLink', () => {
    it('returns the stored name and the fields, read with getValue', async () => {
        const row = { name: 'user@example.com', full_name: 'Test User' }
        const { frappe, requests } = client([json(200, { message: row })])
        await expect(frappe.doc.validateLink('User', 'USER@example.com', ['full_name'])).resolves.toEqual(row)
        expect(queryOf(only(requests))).toEqual({
            doctype: 'User',
            fieldname: ['name', 'full_name'],
            filters: [['name', '=', 'USER@example.com']],
        })
    })

    it('asks for `name` once, and for `name` alone without fields', async () => {
        const { frappe, requests } = client([
            json(200, { message: { name: 'A' } }),
            json(200, { message: { name: 'A' } }),
        ])
        await frappe.doc.validateLink('User', 'A', ['name', 'full_name'])
        await expect(frappe.doc.validateLink('User', 'A')).resolves.toEqual({ name: 'A' })
        expect(requests.map((request) => queryOf(request)['fieldname'])).toEqual([['name', 'full_name'], ['name']])
    })

    it('is null when there is no such document', async () => {
        const { frappe } = client([json(200, { message: {} })])
        await expect(frappe.doc.validateLink('User', 'no-such-user')).resolves.toBeNull()
    })

    it.each([
        ['`fields` that is not an array', 'full_name', '`fields` must be an array of field names.'],
        ['a field that is not a column name', ['*'], 'Each field must be a field name such as "modified"; got *.'],
    ])('rejects %s without sending', async (_title, fields, message) => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.validateLink('User', 'A', fields as never)).rejects.toThrow(
            new InvalidArgumentError(message),
        )
        expect(requests).toHaveLength(0)
    })

    it('rejects an empty name without sending', async () => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.validateLink('User', '')).rejects.toThrow(new InvalidArgumentError(NAME_ERROR))
        expect(requests).toHaveLength(0)
    })
})

describe('doc.isAmended', () => {
    it('is true when Frappe answers the amendment’s name', async () => {
        const { frappe, requests } = client([json(200, { message: 'SINV-0001-1' })])
        await expect(frappe.doc.isAmended('Sales Invoice', 'SINV-0001')).resolves.toBe(true)
        const request = only(requests)
        // A POST: Frappe 16 lets a browser cache the GET answer for 10 minutes.
        expect(request.method).toBe('POST')
        expect(request.url).toBe(method('is_document_amended'))
        expect(await request.json()).toEqual({ doctype: 'Sales Invoice', docname: 'SINV-0001' })
    })

    it('is true for a numeric name, from a DocType named by "Autoincrement"', async () => {
        const { frappe, requests } = client([json(200, { message: 8 })])
        await expect(frappe.doc.isAmended('Counter', 7)).resolves.toBe(true)
        expect(await only(requests).json()).toEqual({ doctype: 'Counter', docname: '7' })
    })

    it.each([
        ['null', { message: null }],
        ['false, for a DocType the user cannot read', { message: false }],
        ['no `message`', {}],
        ['an empty name', { message: '' }],
    ])('is false for %s', async (_title, body) => {
        const { frappe } = client([json(200, body)])
        await expect(frappe.doc.isAmended('Sales Invoice', 'SINV-0001')).resolves.toBe(false)
    })

    it('rejects any other answer', async () => {
        const { frappe } = client([json(200, { message: true })])
        await expect(frappe.doc.isAmended('Sales Invoice', 'SINV-0001')).rejects.toMatchObject({
            message: `Expected a name, null or false in \`message\` from POST ${method('is_document_amended')}.`,
        })
    })

    it('rejects invalid arguments without sending', async () => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.isAmended('', 'X')).rejects.toBeInstanceOf(InvalidArgumentError)
        await expect(frappe.doc.isAmended('Sales Invoice', 0)).rejects.toThrow(new InvalidArgumentError(NAME_ERROR))
        expect(requests).toHaveLength(0)
    })
})

describe('doc.getPassword', () => {
    it('returns the decrypted value of a Password field', async () => {
        const { frappe, requests } = client([json(200, { message: 'hunter2' })])
        await expect(frappe.doc.getPassword('Counter', 7, 'secret')).resolves.toBe('hunter2')
        const request = only(requests)
        expect(request.url.startsWith(method('get_password'))).toBe(true)
        expect(new URL(request.url).search).toBe('?doctype=Counter&name=7&fieldname=secret')
    })

    it('passes Frappe’s 417 for a field with no stored password through', async () => {
        const message = 'Password not found for Counter 7 secret'
        const { frappe } = client([
            json(417, {
                exc_type: 'ValidationError',
                _server_messages: JSON.stringify([JSON.stringify({ message })]),
            }),
        ])
        const error = await frappe.doc.getPassword('Counter', 7, 'secret').catch((error: unknown) => error)
        expect(error).toBeInstanceOf(ValidationError)
        expect(error).toMatchObject({ status: 417, exceptionType: 'ValidationError', message })
    })

    it('rejects a `message` that is not a string', async () => {
        const { frappe } = client([json(200, {})])
        await expect(frappe.doc.getPassword('Counter', 7, 'secret')).rejects.toMatchObject({
            message: `Expected a string in \`message\` from GET ${method('get_password')}.`,
        })
    })

    it('rejects invalid arguments without sending', async () => {
        const { frappe, requests } = client([])
        await expect(frappe.doc.getPassword('', 7, 'secret')).rejects.toBeInstanceOf(InvalidArgumentError)
        await expect(frappe.doc.getPassword('Counter', -7, 'secret')).rejects.toThrow(
            new InvalidArgumentError(NAME_ERROR),
        )
        await expect(frappe.doc.getPassword('Counter', 7, '')).rejects.toBeInstanceOf(InvalidArgumentError)
        expect(requests).toHaveLength(0)
    })
})
