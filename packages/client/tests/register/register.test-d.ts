import { describe, expectTypeOf, it } from 'vitest'

import type { DocOf, DocTypeName, FrappeDoc, ListRow, RegisteredDocTypes, UnknownDoc } from '../../src/index.js'

interface Task extends FrappeDoc {
    doctype: 'Task'
    subject: string
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

// A `createClient` typed from Register, with no generics at the call site.
declare function createClient<D extends object = RegisteredDocTypes>(): {
    get<K extends DocTypeName<D>>(doctype: K, name: string): DocOf<D, K>
}

describe('Register', () => {
    it('the augmentation becomes the registered DocType map', () => {
        expectTypeOf<RegisteredDocTypes>().toEqualTypeOf<DocTypes>()
        expectTypeOf<'Task'>().toExtend<DocTypeName<RegisteredDocTypes>>()
    })

    it('types a call from the DocType name alone', () => {
        const frappe = createClient()

        expectTypeOf(frappe.get('Task', 'TASK-0001')).toEqualTypeOf<Task>()
        expectTypeOf<ListRow<DocOf<RegisteredDocTypes, 'Task'>, readonly ['subject']>>().toEqualTypeOf<{
            subject: string
        }>()
    })

    it('keeps DocTypes that were not generated loose', () => {
        expectTypeOf(createClient().get('Note', 'NOTE-1')).toEqualTypeOf<UnknownDoc>()
    })
})
