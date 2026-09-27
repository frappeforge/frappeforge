import { describe, expectTypeOf, it } from 'vitest'

import {
    createClient,
    type DocNamespace,
    type FrappeClient,
    type FrappeDoc,
    type GetValueResult,
    type ListRow,
    type PaginateArgs,
    type PermissionType,
    tokenAuth,
    type UnknownDoc,
    type ValueField,
} from '../src/index.js'

// Fixtures in the shape `@frappeforge/codegen` emits.

interface TaskDependsOn extends FrappeDoc {
    doctype: 'Task Depends On'
    name: string
    parent: string
    parentfield: string
    parenttype: string
    task?: string | null
}

interface Task extends FrappeDoc {
    doctype: 'Task'
    name: string
    subject: string
    status?: 'Open' | 'Working' | 'Completed' | null
    priority: number
    // A field with permlevel > 0: users who cannot read it never receive it.
    salary?: number
    depends_on: TaskDependsOn[]
}

interface SalesInvoice extends FrappeDoc {
    doctype: 'Sales Invoice'
    name: string
    customer: string
    grand_total: number
}

// A DocType named by "Autoincrement": codegen narrows `name` to a number.
interface Counter extends FrappeDoc {
    doctype: 'Counter'
    name: number
    label?: string | null
    secret?: string | null
}

interface DocTypes {
    Counter: Counter
    Task: Task
    'Task Depends On': TaskDependsOn
    'Sales Invoice': SalesInvoice
}

const url = 'https://example.com'
const frappe = createClient<DocTypes>({ url, auth: tokenAuth({ apiKey: 'key', apiSecret: 'secret' }) })

type Status = 'Open' | 'Working' | 'Completed'

describe('createClient', () => {
    it('is typed by the DocType map it is given', () => {
        expectTypeOf(frappe).toEqualTypeOf<FrappeClient<DocTypes>>()
        expectTypeOf(frappe.doc).toEqualTypeOf<DocNamespace<DocTypes>>()
    })

    it('keeps FrappeClient usable without a type argument', () => {
        const client: FrappeClient = createClient({ url })
        expectTypeOf(client.doc.get('Task', 'TASK-0001')).resolves.toEqualTypeOf<UnknownDoc>()
    })
})

describe('doc.get and doc.getSingle', () => {
    it('return the generated interface', () => {
        expectTypeOf(frappe.doc.get('Task', 'TASK-0001')).resolves.toEqualTypeOf<Task>()
        expectTypeOf(frappe.doc.getSingle('Task')).resolves.toEqualTypeOf<Task>()
    })

    it('accept a DocType that was not generated, with unknown values', () => {
        expectTypeOf(frappe.doc.get('Note', 'NOTE-1')).resolves.toEqualTypeOf<UnknownDoc>()
        expectTypeOf(frappe.doc.getSingle('System Settings')).resolves.toEqualTypeOf<UnknownDoc>()
    })

    it('autocompletes generated DocType names', () => {
        expectTypeOf(frappe.doc.get).parameter(0).toExtend<string>()
        expectTypeOf<'Task'>().toExtend<Parameters<typeof frappe.doc.get>[0]>()
    })
})

describe('doc.getList', () => {
    it('returns exactly the requested fields, as optional as the interface declares them', async () => {
        const open = await frappe.doc.getList('Task', {
            fields: ['name', 'subject', 'status'],
            filters: { status: 'Open', priority: ['>', 2] },
            orderBy: [{ field: 'priority', order: 'desc' }, { field: 'modified' }],
            limit: 50,
        })
        expectTypeOf(open).toEqualTypeOf<{ name: string; subject: string; status?: Status | null }[]>()
    })

    it('infers fields from a const array too', () => {
        const fields = ['subject', 'priority'] as const
        expectTypeOf(frappe.doc.getList('Task', { fields })).resolves.toEqualTypeOf<
            { subject: string; priority: number }[]
        >()
    })

    it('replaces list, which no longer exists', () => {
        expectTypeOf(frappe.doc).not.toHaveProperty('list')
    })

    it('returns name alone when fields are left out', () => {
        expectTypeOf(frappe.doc.getList('Task')).resolves.toEqualTypeOf<{ name: string }[]>()
        expectTypeOf(frappe.doc.getList('Task', { filters: { status: 'Open' } })).resolves.toEqualTypeOf<
            { name: string }[]
        >()
    })

    it('returns every column with ["*"], but no child table', () => {
        const rows = frappe.doc.getList('Task', { fields: ['*'] })
        expectTypeOf(rows).resolves.toEqualTypeOf<ListRow<Task, readonly ['*']>[]>()
        expectTypeOf<ListRow<Task, readonly ['*']>>().not.toHaveProperty('depends_on')
        expectTypeOf<ListRow<Task, readonly ['*']>>().toHaveProperty('subject').toEqualTypeOf<string>()
    })

    it('keeps a DocType that was not generated loose', () => {
        expectTypeOf(frappe.doc.getList('Note', { fields: ['name', 'custom_field'] })).resolves.toEqualTypeOf<
            { name: string | number; custom_field: unknown }[]
        >()
    })

    it('rejects a field the document does not have, and a table', () => {
        // @ts-expect-error `assignee` is not a field of Task
        const unknownField = frappe.doc.getList('Task', { fields: ['assignee'] })
        // @ts-expect-error lists never return child rows
        const table = frappe.doc.getList('Task', { fields: ['depends_on'] })

        expectTypeOf([unknownField, table]).toExtend<Promise<unknown>[]>()
    })

    it('rejects a typo in a Select value at the call site', () => {
        // @ts-expect-error `Opne` is not a status
        const filters = frappe.doc.getList('Task', { filters: { status: 'Opne' } })
        // @ts-expect-error `Opne` is not a status
        const orFilters = frappe.doc.getList('Task', { orFilters: { status: 'Opne' } })
        // @ts-expect-error `stauts` is not a field of Task
        const unknownField = frappe.doc.getList('Task', { filters: { stauts: 'Open' } })

        expectTypeOf(filters).resolves.toEqualTypeOf<{ name: string }[]>()
        expectTypeOf([orFilters, unknownField]).toExtend<Promise<unknown>[]>()
    })
})

describe('parent', () => {
    it('lists a child table by its parent DocType', () => {
        expectTypeOf(
            frappe.doc.getList('Task Depends On', { fields: ['task'], parent: 'Task' }),
        ).resolves.toEqualTypeOf<{ task?: string | null }[]>()
        expectTypeOf(frappe.doc.paginate('Task Depends On', { parent: 'Task' })).toEqualTypeOf<
            AsyncGenerator<{ name: string }, void, undefined>
        >()
        expectTypeOf(frappe.doc.getList('Note', { parent: 'Task' })).resolves.toEqualTypeOf<
            { name: string | number }[]
        >()
    })

    it('is rejected for a DocType that is not a child table', () => {
        // @ts-expect-error Task is not a child table
        void frappe.doc.getList('Task', { parent: 'User' })
        // @ts-expect-error Task is not a child table
        void frappe.doc.paginate('Task', { parent: 'User' })
        expectTypeOf<PaginateArgs<Task>>().toHaveProperty('parent').toEqualTypeOf<undefined>()
    })
})

describe('doc.count', () => {
    it('returns a number and checks its filters', () => {
        expectTypeOf(frappe.doc.count('Task', { status: 'Open' })).resolves.toEqualTypeOf<number>()
        expectTypeOf(frappe.doc.count('Note')).resolves.toEqualTypeOf<number>()
        // @ts-expect-error `Opne` is not a status
        void frappe.doc.count('Task', { status: 'Opne' })
    })
})

describe('doc.paginate', () => {
    it('yields the requested fields plus name, the cursor', async () => {
        let total = 0
        for await (const row of frappe.doc.paginate('Sales Invoice', {
            fields: ['grand_total'],
            filters: { docstatus: 1 },
        })) {
            expectTypeOf(row).toEqualTypeOf<{ grand_total: number; name: string }>()
            total += row.grand_total
        }
        expectTypeOf(total).toEqualTypeOf<number>()
    })

    it('yields name alone by default, and every column with ["*"]', () => {
        expectTypeOf(frappe.doc.paginate('Task')).toEqualTypeOf<AsyncGenerator<{ name: string }, void, undefined>>()
        expectTypeOf(frappe.doc.paginate('Task', { fields: ['*'] })).toEqualTypeOf<
            AsyncGenerator<ListRow<Task, readonly ['*']>, void, undefined>
        >()
        expectTypeOf(frappe.doc.paginate('Note', { fields: ['custom_field'] })).toEqualTypeOf<
            AsyncGenerator<{ custom_field: unknown; name: string | number }, void, undefined>
        >()
    })

    it('has no order, grouping or paging of its own', () => {
        // @ts-expect-error the order is the cursor
        void frappe.doc.paginate('Task', { orderBy: { field: 'modified' } })
        // @ts-expect-error pages are sized with pageSize
        void frappe.doc.paginate('Task', { limit: 10 })
        expectTypeOf<PaginateArgs<Task>>().toHaveProperty('pageSize').toEqualTypeOf<number | undefined>()
    })

    it('rejects a typo in a Select value at the call site', () => {
        // @ts-expect-error `Opne` is not a status
        const rows = frappe.doc.paginate('Task', { filters: { status: 'Opne' } })

        expectTypeOf(rows).toEqualTypeOf<AsyncGenerator<{ name: string }, void, undefined>>()
    })
})

describe('document names', () => {
    it('keeps a narrowed numeric name through documents and rows', () => {
        expectTypeOf(frappe.doc.get('Counter', 5)).resolves.toHaveProperty('name').toEqualTypeOf<number>()
        expectTypeOf(frappe.doc.getList('Counter', { fields: ['name', 'label'] })).resolves.toEqualTypeOf<
            { name: number; label?: string | null }[]
        >()
        expectTypeOf(frappe.doc.paginate('Counter')).toEqualTypeOf<AsyncGenerator<{ name: number }, void, undefined>>()
    })

    it('accepts a name as a number or as the string a Link field holds, for any DocType', () => {
        expectTypeOf(frappe.doc.get<'Counter'>)
            .parameter(1)
            .toEqualTypeOf<string | number>()
        void frappe.doc.get('Counter', '5')
        void frappe.doc.get('Task', 5)
        void frappe.doc.hasPermission('Counter', 5)
        void frappe.doc.isAmended('Task', 'TASK-0001')
        // @ts-expect-error a boolean is not a name
        void frappe.doc.get('Counter', true)
        // @ts-expect-error a boolean is not a name
        void frappe.doc.getValue('Counter', true, 'label')
    })
})

describe('doc.getValue', () => {
    it('returns the value for one field, and a row for several', () => {
        expectTypeOf(frappe.doc.getValue('Task', 'TASK-0001', 'status')).resolves.toEqualTypeOf<Status | null>()
        expectTypeOf(frappe.doc.getValue('Task', 'TASK-0001', 'priority')).resolves.toEqualTypeOf<number | null>()
        expectTypeOf(frappe.doc.getValue('Counter', 5, 'name')).resolves.toEqualTypeOf<number | null>()
        expectTypeOf(
            frappe.doc.getValue('Task', { status: 'Open' }, ['name', 'status', 'priority']),
        ).resolves.toEqualTypeOf<{ name: string; status?: Status | null; priority: number } | null>()
    })

    it('checks field names and filters against the DocType', () => {
        expectTypeOf<'stauts' | '*' | 'depends_on'>().not.toExtend<ValueField<Task>>()
        // @ts-expect-error not a field of Task
        void frappe.doc.getValue('Task', 'TASK-0001', 'stauts')
        // @ts-expect-error `*` selects no single column
        void frappe.doc.getValue('Task', 'TASK-0001', ['*'])
        // @ts-expect-error a child table is not a column
        void frappe.doc.getValue('Task', 'TASK-0001', 'depends_on')
        // @ts-expect-error `Opne` is not a status
        void frappe.doc.getValue('Task', { status: 'Opne' }, 'name')
    })

    it('names its result GetValueResult', () => {
        expectTypeOf<GetValueResult<Task, 'status'>>().toEqualTypeOf<Status | null>()
        expectTypeOf<GetValueResult<Task, readonly ['subject', 'priority']>>().toEqualTypeOf<{
            subject: string
            priority: number
        }>()
        expectTypeOf<GetValueResult<UnknownDoc, 'title'>>().toEqualTypeOf<unknown>()
    })

    it('takes `parent` for a child table only', () => {
        expectTypeOf(
            frappe.doc.getValue('Task Depends On', { task: 'TASK-0001' }, 'task', { parent: 'Task' }),
        ).resolves.toEqualTypeOf<string | null>()
        expectTypeOf(
            frappe.doc.exists('Task Depends On', { task: 'TASK-0001' }, { parent: 'Task', timeout: 5000 }),
        ).resolves.toEqualTypeOf<boolean>()
        void frappe.doc.getValue('Has Role', { role: 'System Manager' }, 'name', { parent: 'User' })
        // @ts-expect-error Task is not a child table
        void frappe.doc.getValue('Task', 'TASK-0001', 'status', { parent: 'Project' })
        // @ts-expect-error Task is not a child table
        void frappe.doc.exists('Task', 'TASK-0001', { parent: 'Project' })
    })

    it('gives unknown values for a DocType that was not generated', () => {
        expectTypeOf(frappe.doc.getValue('Note', 'N-1', 'title')).resolves.toEqualTypeOf<unknown>()
        expectTypeOf(frappe.doc.getValue('Note', 'N-1', ['title', 'name'])).resolves.toEqualTypeOf<{
            title: unknown
            name: string | number
        } | null>()
    })
})

describe('doc.getSingleValue', () => {
    it('returns the field type, or null', () => {
        expectTypeOf(frappe.doc.getSingleValue('Task', 'priority')).resolves.toEqualTypeOf<number | null>()
        // Frappe casts a text or select field that was never set to ''.
        expectTypeOf(frappe.doc.getSingleValue('Task', 'status')).resolves.toEqualTypeOf<Status | '' | null>()
        expectTypeOf(frappe.doc.getSingleValue('Task', 'subject')).resolves.toEqualTypeOf<string | null>()
        expectTypeOf(frappe.doc.getSingleValue('System Settings', 'country')).resolves.toEqualTypeOf<unknown>()
        // @ts-expect-error a child table is not a column
        void frappe.doc.getSingleValue('Task', 'depends_on')
    })
})

describe('the checks', () => {
    it('return booleans', () => {
        expectTypeOf(frappe.doc.exists('Task', 'TASK-0001')).resolves.toEqualTypeOf<boolean>()
        expectTypeOf(frappe.doc.exists('Task', { status: 'Open' })).resolves.toEqualTypeOf<boolean>()
        expectTypeOf(frappe.doc.hasPermission('Task', 'TASK-0001', 'write')).resolves.toEqualTypeOf<boolean>()
        expectTypeOf(frappe.doc.isAmended('Task', 'TASK-0001')).resolves.toEqualTypeOf<boolean>()
        // @ts-expect-error `Opne` is not a status
        void frappe.doc.exists('Task', { status: 'Opne' })
    })

    it('accept only Frappe’s permission types', () => {
        expectTypeOf<PermissionType>().toExtend<string>()
        // @ts-expect-error misspelled
        void frappe.doc.hasPermission('Task', 'TASK-0001', 'wirte')
    })
})

describe('doc.validateLink', () => {
    it('returns the name and the requested fields, or null', () => {
        expectTypeOf(frappe.doc.validateLink('Task', 'TASK-0001')).resolves.toEqualTypeOf<{ name: string } | null>()
        expectTypeOf(frappe.doc.validateLink('Task', 'TASK-0001', ['subject'])).resolves.toEqualTypeOf<{
            name: string
            subject: string
        } | null>()
        expectTypeOf(frappe.doc.validateLink('Counter', '5', ['label'])).resolves.toEqualTypeOf<{
            name: number
            label?: string | null
        } | null>()
        // @ts-expect-error not a field of Task
        void frappe.doc.validateLink('Task', 'TASK-0001', ['stauts'])
    })
})

describe('doc.getPassword', () => {
    it('returns a string and checks the field', () => {
        expectTypeOf(frappe.doc.getPassword('Counter', 5, 'secret')).resolves.toEqualTypeOf<string>()
        // @ts-expect-error not a field of Counter
        void frappe.doc.getPassword('Counter', 5, 'secert')
    })
})

describe('the examples in the method docs', () => {
    // A client without generated types, as a reader copying an example has.
    const frappe = createClient({ url })

    it('compile without generated types', async () => {
        const todo = await frappe.doc.get('ToDo', 'TODO-0001')
        const settings = await frappe.doc.getSingle('System Settings')
        const open = await frappe.doc.getList('ToDo', {
            fields: ['name', 'description', 'priority'],
            filters: { status: 'Open' },
            orderBy: { field: 'modified', order: 'desc' },
            limit: 50,
        })
        const openCount = await frappe.doc.count('ToDo', { status: 'Open' })
        let total = 0
        for await (const invoice of frappe.doc.paginate('Sales Invoice', {
            fields: ['grand_total'],
            filters: { docstatus: 1 },
        })) {
            total += Number(invoice.grand_total)
        }

        expectTypeOf([todo, settings]).toEqualTypeOf<UnknownDoc[]>()
        expectTypeOf(open).toEqualTypeOf<{ name: string | number; description: unknown; priority: unknown }[]>()
        expectTypeOf([openCount, total]).toEqualTypeOf<number[]>()
    })

    it('compile the single values and checks without generated types', async () => {
        const status = await frappe.doc.getValue('ToDo', 'TODO-0001', 'status')
        const row = await frappe.doc.getValue('ToDo', { status: 'Open' }, ['name', 'allocated_to'])
        const country = await frappe.doc.getSingleValue('System Settings', 'country')
        const known = await frappe.doc.exists('User', 'user@example.com')
        const canEdit = await frappe.doc.hasPermission('ToDo', 'TODO-0001', 'write')
        const user = await frappe.doc.validateLink('User', 'USER@example.com', ['full_name'])
        const amended = await frappe.doc.isAmended('Sales Invoice', 'SINV-0001')
        const secret = await frappe.doc.getPassword('Email Account', 'Support', 'password')

        expectTypeOf([status, country]).toEqualTypeOf<unknown[]>()
        expectTypeOf(row).toEqualTypeOf<{ name: string | number; allocated_to: unknown } | null>()
        expectTypeOf(user).toEqualTypeOf<{ full_name: unknown; name: string | number } | null>()
        expectTypeOf([known, canEdit, amended]).toEqualTypeOf<boolean[]>()
        expectTypeOf(secret).toEqualTypeOf<string>()
    })
})
