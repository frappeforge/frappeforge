// The generated module drives `@frappeforge/client`'s types, through its published declarations.
// `golden/ff.generated.ts` declares its DocTypes in `Register`, so `createClient()` needs no type
// argument; it is the only golden file that does, as two declarations would conflict.

import { type ChildFilterTuple, type ColumnOf, createClient, type UnknownDoc } from '@frappeforge/client'
import { describe, expectTypeOf, it } from 'vitest'

import type { FFCounter, FFKitchenSink, FFKitchenSinkItem } from './golden/ff.generated.js'
import type { DocTypes as V15DocTypes } from './golden/v15.generated.js'
import type { DocTypes as V16DocTypes, SalesOrder } from './golden/v16.generated.js'

const frappe = createClient({ url: 'https://example.com' })

describe('generated DocTypes, registered', () => {
    it('type a document from the DocType name alone', () => {
        expectTypeOf(frappe.doc.get('FF Kitchen Sink', 'KS-0001')).resolves.toEqualTypeOf<FFKitchenSink>()
        expectTypeOf(frappe.doc.get('FF Kitchen Sink Item', 'row-1')).resolves.toEqualTypeOf<FFKitchenSinkItem>()
    })

    it('type list rows as exactly the fields asked for, with their nullability', () => {
        expectTypeOf(
            frappe.doc.getList('FF Kitchen Sink', { fields: ['title', 'priority', 'status'] }),
        ).resolves.toEqualTypeOf<{ title: string; priority: number; status?: '' | 'Open' | 'Closed' | null }[]>()
    })

    it('type a single value, null when empty or missing', () => {
        expectTypeOf(frappe.doc.getValue('FF Kitchen Sink', 'KS-0001', 'assigned_to')).resolves.toEqualTypeOf<
            string | null
        >()
    })

    it('type an autoincrement name as a number', async () => {
        const counter = await frappe.doc.get('FF Counter', 1)

        expectTypeOf(counter).toEqualTypeOf<FFCounter>()
        expectTypeOf(counter.name).toEqualTypeOf<number>()
        expectTypeOf(frappe.doc.getList('FF Counter', { fields: ['name'] })).resolves.toEqualTypeOf<
            { name: number }[]
        >()
    })

    it('check filter values against the field types', () => {
        expectTypeOf(frappe.doc.count('FF Kitchen Sink', { status: 'Open', approved: true })).resolves.toBeNumber()
        // @ts-expect-error `Opne` is not a status
        void frappe.doc.count('FF Kitchen Sink', { status: 'Opne' })
        // @ts-expect-error `kind` is a Select of Goods and Services
        void frappe.doc.count('FF Kitchen Sink', { kind: 'Software' })
    })

    it('check child-table filters against the child DocType', () => {
        expectTypeOf(
            frappe.doc.count('FF Kitchen Sink', [['FF Kitchen Sink Item', 'qty', '>', 1]]),
        ).resolves.toBeNumber()
        expectTypeOf<['FF Kitchen Sink Item', 'qty', '>', 1]>().toExtend<ChildFilterTuple<FFKitchenSink>>()
        // `external_items` holds rows of a DocType that is not generated, so a tuple naming it is loose.
        expectTypeOf<['FF External Item', 'anything', '=', 1]>().toExtend<ChildFilterTuple<FFKitchenSink>>()
        // Without it, every child field is checked.
        expectTypeOf<['FF Kitchen Sink Item', 'qty', '>', 1]>().toExtend<
            ChildFilterTuple<Omit<FFKitchenSink, 'external_items'>>
        >()
        expectTypeOf<['FF Kitchen Sink Item', 'weight', '>', 1]>().not.toExtend<
            ChildFilterTuple<Omit<FFKitchenSink, 'external_items'>>
        >()
    })

    it('accept `parent` only for a child table', () => {
        expectTypeOf(
            frappe.doc.getList('FF Kitchen Sink Item', { parent: 'FF Kitchen Sink', fields: ['qty'] }),
        ).resolves.toEqualTypeOf<{ qty: number }[]>()
        // @ts-expect-error FF Kitchen Sink is not a child table
        void frappe.doc.getList('FF Kitchen Sink', { parent: 'FF Order' })
    })

    it('leave child tables out of list fields, as lists never return them', () => {
        expectTypeOf<Extract<ColumnOf<FFKitchenSink>, 'items' | 'tags' | 'external_items'>>().toBeNever()
        // @ts-expect-error `items` is a child table
        void frappe.doc.getList('FF Kitchen Sink', { fields: ['items'] })
    })

    it('accept child rows on insert, and reject server-assigned fields', () => {
        expectTypeOf(
            frappe.doc.insert('FF Kitchen Sink', { title: 'Support', kind: 'Services', items: [{ qty: 2 }] }),
        ).resolves.toEqualTypeOf<FFKitchenSink>()
        // @ts-expect-error the server assigns `owner`
        void frappe.doc.insert('FF Kitchen Sink', { title: 'Support', owner: 'user@example.com' })
    })

    it('type masked fields, rows of a child that is not generated, and unknown fieldtypes honestly', () => {
        expectTypeOf<FFKitchenSink['discount']>().toEqualTypeOf<number | string>()
        expectTypeOf<FFKitchenSink['phase']>().toEqualTypeOf<string | null | undefined>()
        expectTypeOf<FFKitchenSink['external_items']>().toEqualTypeOf<UnknownDoc[]>()
        expectTypeOf<FFKitchenSink['future_value']>().toEqualTypeOf<unknown>()
    })
})

describe('generated DocTypes from real metadata, passed explicitly', () => {
    const frappe16 = createClient<V16DocTypes>({ url: 'https://example.com' })

    it('type a Sales Order and its list rows', () => {
        expectTypeOf(frappe16.doc.get('Sales Order', 'SAL-ORD-2026-00001')).resolves.toEqualTypeOf<SalesOrder>()
        expectTypeOf(
            frappe16.doc.getList('Sales Order', { fields: ['customer', 'grand_total'] }),
        ).resolves.toEqualTypeOf<{ customer: string; grand_total: number }[]>()
        expectTypeOf(frappe16.doc.getValue('Sales Order', 'SAL-ORD-2026-00001', 'customer')).resolves.toEqualTypeOf<
            string | null
        >()
    })

    it('check a status against its Select options', () => {
        expectTypeOf(frappe16.doc.count('Sales Order', { status: 'Draft' })).resolves.toBeNumber()
        // @ts-expect-error `Drafty` is not a Sales Order status
        void frappe16.doc.count('Sales Order', { status: 'Drafty' })
    })

    it("find empty values of a Select that is not mandatory, as Frappe saves '' there", () => {
        expectTypeOf(frappe16.doc.count('ToDo', { status: '' })).resolves.toBeNumber()
        // @ts-expect-error `naming_series` is mandatory and has no blank option
        void frappe16.doc.count('Sales Order', { naming_series: '' })
    })

    it('follow the version they were generated from', () => {
        const frappe15 = createClient<V15DocTypes>({ url: 'https://example.com' })

        expectTypeOf(frappe16.doc.count('Sales Order', { status: 'To Pay' })).resolves.toBeNumber()
        // @ts-expect-error ERPNext 15 has no `To Pay` status
        void frappe15.doc.count('Sales Order', { status: 'To Pay' })
    })

    it('check a child-table filter on Sales Order Item', () => {
        expectTypeOf<['Sales Order Item', 'item_code', '=', 'ITEM-0001']>().toExtend<ChildFilterTuple<SalesOrder>>()
        expectTypeOf<['Sales Order Item', 'no_such_field', '=', 1]>().not.toExtend<ChildFilterTuple<SalesOrder>>()
    })
})
