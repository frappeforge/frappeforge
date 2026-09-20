import { describe, expectTypeOf, it } from 'vitest'

import type { DocOf, FieldOf, Filters, FrappeDoc, ListArgs } from '../src/types.js'

interface Task extends FrappeDoc {
    subject: string
    status: 'Open' | 'Completed'
    priority: number
}

interface DocTypes {
    Task: Task
}

describe('DocOf', () => {
    it('resolves a known DocType name to its interface', () => {
        expectTypeOf<DocOf<DocTypes, 'Task'>>().toEqualTypeOf<Task>()
    })

    it('falls back to FrappeDoc for a name that is not in the map', () => {
        expectTypeOf<DocOf<DocTypes, 'Unknown DocType'>>().toEqualTypeOf<FrappeDoc>()
    })
})

describe('FieldOf', () => {
    it('includes the document fields and the server-assigned ones', () => {
        expectTypeOf<'subject'>().toExtend<FieldOf<Task>>()
        expectTypeOf<'modified'>().toExtend<FieldOf<Task>>()
    })
})

describe('Filters', () => {
    it('accepts the shorthand object form', () => {
        const byStatus = { status: 'Open' } satisfies Filters<Task>

        expectTypeOf(byStatus).toExtend<Filters<Task>>()
    })

    it('accepts operator tuples', () => {
        const byPriority = [['priority', '>', 2]] satisfies Filters<Task>

        expectTypeOf(byPriority).toExtend<Filters<Task>>()
    })

    it('rejects a field the document does not have', () => {
        // @ts-expect-error `assignee` is not a field of Task
        const unknownField: Filters<Task> = { assignee: 'someone@example.com' }

        expectTypeOf(unknownField).toExtend<Filters<Task>>()
    })
})

describe('ListArgs', () => {
    it('accepts fields, filters and pagination together', () => {
        const args = {
            fields: ['name', 'subject'],
            filters: { status: 'Open' },
            orderBy: { field: 'modified', order: 'desc' },
            limit: 20,
            offset: 40,
        } satisfies ListArgs<Task>

        expectTypeOf(args).toExtend<ListArgs<Task>>()
    })

    it('rejects a field the document does not have', () => {
        // @ts-expect-error `assignee` is not a field of Task
        const args: ListArgs<Task> = { fields: ['assignee'] }

        expectTypeOf(args).toExtend<ListArgs<Task>>()
    })

    it('rejects an unknown sort direction', () => {
        // @ts-expect-error only `asc` and `desc` are valid
        const args: ListArgs<Task> = { orderBy: { field: 'modified', order: 'sideways' } }

        expectTypeOf(args).toExtend<ListArgs<Task>>()
    })
})
