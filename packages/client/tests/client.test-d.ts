import { describe, expectTypeOf, it } from 'vitest'

import {
    createClient,
    type DocNamespace,
    type FrappeClient,
    type FrappeDoc,
    type ListRow,
    type PaginateArgs,
    tokenAuth,
    type UnknownDoc,
} from '../src/index.js'

// Fixtures in the shape `@frappeforge/codegen` emits.

interface TaskDependsOn extends FrappeDoc {
    doctype: 'Task Depends On'
    parent: string
    parentfield: string
    parenttype: string
    task?: string | null
}

interface Task extends FrappeDoc {
    doctype: 'Task'
    subject: string
    status?: 'Open' | 'Working' | 'Completed' | null
    priority: number
    // A field with permlevel > 0: users who cannot read it never receive it.
    salary?: number
    depends_on: TaskDependsOn[]
}

interface SalesInvoice extends FrappeDoc {
    doctype: 'Sales Invoice'
    customer: string
    grand_total: number
}

interface DocTypes {
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

describe('doc.list', () => {
    it('returns exactly the requested fields, as optional as the interface declares them', async () => {
        const open = await frappe.doc.list('Task', {
            fields: ['name', 'subject', 'status'],
            filters: { status: 'Open', priority: ['>', 2] },
            orderBy: [{ field: 'priority', order: 'desc' }, { field: 'modified' }],
            limit: 50,
        })
        expectTypeOf(open).toEqualTypeOf<{ name: string; subject: string; status?: Status | null }[]>()
    })

    it('infers fields from a const array too', () => {
        const fields = ['subject', 'priority'] as const
        expectTypeOf(frappe.doc.list('Task', { fields })).resolves.toEqualTypeOf<
            { subject: string; priority: number }[]
        >()
    })

    it('returns name alone when fields are left out', () => {
        expectTypeOf(frappe.doc.list('Task')).resolves.toEqualTypeOf<{ name: string }[]>()
        expectTypeOf(frappe.doc.list('Task', { filters: { status: 'Open' } })).resolves.toEqualTypeOf<
            { name: string }[]
        >()
    })

    it('returns every column with ["*"], but no child table', () => {
        const rows = frappe.doc.list('Task', { fields: ['*'] })
        expectTypeOf(rows).resolves.toEqualTypeOf<ListRow<Task, readonly ['*']>[]>()
        expectTypeOf<ListRow<Task, readonly ['*']>>().not.toHaveProperty('depends_on')
        expectTypeOf<ListRow<Task, readonly ['*']>>().toHaveProperty('subject').toEqualTypeOf<string>()
    })

    it('keeps a DocType that was not generated loose', () => {
        expectTypeOf(frappe.doc.list('Note', { fields: ['name', 'custom_field'] })).resolves.toEqualTypeOf<
            { name: string; custom_field: unknown }[]
        >()
    })

    it('rejects a field the document does not have, and a table', () => {
        // @ts-expect-error `assignee` is not a field of Task
        const unknownField = frappe.doc.list('Task', { fields: ['assignee'] })
        // @ts-expect-error lists never return child rows
        const table = frappe.doc.list('Task', { fields: ['depends_on'] })

        expectTypeOf([unknownField, table]).toExtend<Promise<unknown>[]>()
    })

    it('rejects a typo in a Select value at the call site', () => {
        // @ts-expect-error `Opne` is not a status
        const filters = frappe.doc.list('Task', { filters: { status: 'Opne' } })
        // @ts-expect-error `Opne` is not a status
        const orFilters = frappe.doc.list('Task', { orFilters: { status: 'Opne' } })
        // @ts-expect-error `stauts` is not a field of Task
        const unknownField = frappe.doc.list('Task', { filters: { stauts: 'Open' } })

        expectTypeOf(filters).resolves.toEqualTypeOf<{ name: string }[]>()
        expectTypeOf([orFilters, unknownField]).toExtend<Promise<unknown>[]>()
    })
})

describe('parent', () => {
    it('lists a child table by its parent DocType', () => {
        expectTypeOf(frappe.doc.list('Task Depends On', { fields: ['task'], parent: 'Task' })).resolves.toEqualTypeOf<
            { task?: string | null }[]
        >()
        expectTypeOf(frappe.doc.paginate('Task Depends On', { parent: 'Task' })).toEqualTypeOf<
            AsyncGenerator<{ name: string }, void, undefined>
        >()
        expectTypeOf(frappe.doc.list('Note', { parent: 'Task' })).resolves.toEqualTypeOf<{ name: string }[]>()
    })

    it('is rejected for a DocType that is not a child table', () => {
        // @ts-expect-error Task is not a child table
        void frappe.doc.list('Task', { parent: 'User' })
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
            AsyncGenerator<{ custom_field: unknown; name: string }, void, undefined>
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

describe('the examples in the method docs', () => {
    // A client without generated types, as a reader copying an example has.
    const frappe = createClient({ url })

    it('compile without generated types', async () => {
        const todo = await frappe.doc.get('ToDo', 'TODO-0001')
        const settings = await frappe.doc.getSingle('System Settings')
        const open = await frappe.doc.list('ToDo', {
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
        expectTypeOf(open).toEqualTypeOf<{ name: string; description: unknown; priority: unknown }[]>()
        expectTypeOf([openCount, total]).toEqualTypeOf<number[]>()
    })
})
