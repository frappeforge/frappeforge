import { describe, expectTypeOf, it } from 'vitest'

import {
    createClient,
    type DocOf,
    type DocTypeName,
    type FrappeDoc,
    type ListRow,
    type RegisteredDocTypes,
    type UnknownDoc,
} from '../../src/index.js'

interface Task extends FrappeDoc {
    doctype: 'Task'
    subject: string
    status?: 'Open' | 'Completed' | null
}

// An interface, as codegen may emit: no implicit index signature.
interface DocTypes {
    Task: Task
}

declare module '../../src/index.js' {
    interface Register {
        docTypes: DocTypes
    }
}

describe('Register', () => {
    it('the augmentation becomes the registered DocType map', () => {
        expectTypeOf<RegisteredDocTypes>().toEqualTypeOf<DocTypes>()
        expectTypeOf<'Task'>().toExtend<DocTypeName<RegisteredDocTypes>>()
    })

    it('types a call from the DocType name alone, with no type argument', () => {
        const frappe = createClient({ url: 'https://example.com' })

        expectTypeOf(frappe.doc.get('Task', 'TASK-0001')).resolves.toEqualTypeOf<Task>()
        expectTypeOf(frappe.doc.list('Task', { fields: ['subject'] })).resolves.toEqualTypeOf<{ subject: string }[]>()
        expectTypeOf(frappe.doc.paginate('Task', { fields: ['subject'] })).toEqualTypeOf<
            AsyncGenerator<{ subject: string; name: string }, void, undefined>
        >()
        expectTypeOf<ListRow<DocOf<RegisteredDocTypes, 'Task'>, readonly ['subject']>>().toEqualTypeOf<{
            subject: string
        }>()
    })

    it('checks filter values against the registered types', () => {
        const frappe = createClient({ url: 'https://example.com' })

        // @ts-expect-error `Opne` is not a status
        const count = frappe.doc.count('Task', { status: 'Opne' })

        expectTypeOf(count).resolves.toEqualTypeOf<number>()
    })

    it('keeps DocTypes that were not generated loose', () => {
        const frappe = createClient({ url: 'https://example.com' })

        expectTypeOf(frappe.doc.get('Note', 'NOTE-1')).resolves.toEqualTypeOf<UnknownDoc>()
    })
})
