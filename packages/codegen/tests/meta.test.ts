import { describe, expect, it } from 'vitest'

import { isAutoincremented, normalizeDocType } from '../src/meta.js'

const todo = {
    doctype: 'DocType',
    name: 'ToDo',
    module: 'Desk',
    istable: 0,
    issingle: 0,
    is_submittable: 0,
    autoname: 'hash',
    track_changes: 1,
    fields: [
        {
            doctype: 'DocField',
            fieldname: 'status',
            fieldtype: 'Select',
            label: 'Status',
            options: 'Open\nClosed\nCancelled',
            reqd: 0,
            permlevel: 0,
            is_virtual: 0,
            in_list_view: 1,
        },
        { fieldname: 'description', fieldtype: 'Text Editor', label: 'Description', reqd: 1 },
    ],
}

describe('normalizeDocType', () => {
    it('keeps what the generator reads and turns 0/1 flags into booleans', () => {
        expect(normalizeDocType(todo)).toStrictEqual({
            name: 'ToDo',
            module: 'Desk',
            istable: false,
            issingle: false,
            is_submittable: false,
            autoname: 'hash',
            fields: [
                {
                    fieldname: 'status',
                    fieldtype: 'Select',
                    label: 'Status',
                    options: 'Open\nClosed\nCancelled',
                    reqd: false,
                    permlevel: 0,
                    is_virtual: false,
                    mask: false,
                },
                {
                    fieldname: 'description',
                    fieldtype: 'Text Editor',
                    label: 'Description',
                    reqd: true,
                    permlevel: 0,
                    is_virtual: false,
                    mask: false,
                },
            ],
        })
    })

    it('reads set flags, booleans included, and the descriptions', () => {
        const meta = normalizeDocType({
            name: 'FF Order Item',
            module: 'Custom',
            istable: true,
            is_submittable: 1,
            description: 'One line of an order.',
            fields: [
                {
                    fieldname: 'rate',
                    fieldtype: 'Currency',
                    reqd: true,
                    permlevel: 2,
                    is_virtual: 1,
                    mask: 1,
                    description: 'Before discounts.',
                },
            ],
        })

        expect(meta).toStrictEqual({
            name: 'FF Order Item',
            module: 'Custom',
            istable: true,
            issingle: false,
            is_submittable: true,
            description: 'One line of an order.',
            fields: [
                {
                    fieldname: 'rate',
                    fieldtype: 'Currency',
                    reqd: true,
                    permlevel: 2,
                    is_virtual: true,
                    mask: true,
                    description: 'Before discounts.',
                },
            ],
        })
    })

    it('treats a missing, null or empty value as not set, as Frappe leaves empty keys out', () => {
        const meta = normalizeDocType({
            name: 'Note',
            module: 'Desk',
            istable: null,
            description: '',
            fields: [{ fieldname: 'title', fieldtype: 'Data', label: '', options: null, reqd: null, permlevel: null }],
        })

        expect(meta.istable).toBe(false)
        expect(meta).not.toHaveProperty('description')
        expect(meta.fields[0]).toStrictEqual({
            fieldname: 'title',
            fieldtype: 'Data',
            reqd: false,
            permlevel: 0,
            is_virtual: false,
            mask: false,
        })
    })

    it.each([
        ['autoincrement', 0, true],
        ['autoincrement', 1, false],
        ['hash', 0, false],
        ['field:title', 0, false],
        [undefined, 0, false],
    ])('autoname %s with issingle %i is autoincremented: %s', (autoname, issingle, autoincremented) => {
        expect(
            isAutoincremented(normalizeDocType({ name: 'X', module: 'Custom', autoname, issingle, fields: [] })),
        ).toBe(autoincremented)
    })

    it.each([
        ['not an object', 'ToDo', 'DocType metadata must be an object.'],
        ['an array', [], 'DocType metadata must be an object.'],
        ['no name', { module: 'Desk', fields: [] }, 'DocType metadata: `name` must be a non-empty string.'],
        [
            'a name that is not a string',
            { name: 1, module: 'Desk', fields: [] },
            'DocType metadata: `name` must be a string.',
        ],
        ['no module', { name: 'ToDo', fields: [] }, "DocType 'ToDo': `module` must be a non-empty string."],
        ['no fields', { name: 'ToDo', module: 'Desk' }, "DocType 'ToDo': `fields` must be an array."],
        [
            'a bad flag',
            { name: 'ToDo', module: 'Desk', istable: 2, fields: [] },
            "DocType 'ToDo': `istable` must be 0, 1 or a boolean.",
        ],
        [
            'a bad description',
            { name: 'ToDo', module: 'Desk', description: 1, fields: [] },
            "DocType 'ToDo': `description` must be a string.",
        ],
        [
            'a field that is not an object',
            { name: 'ToDo', module: 'Desk', fields: ['status'] },
            "DocType 'ToDo', fields[0] must be an object.",
        ],
        [
            'a field without a fieldname',
            {
                name: 'ToDo',
                module: 'Desk',
                fields: [{ fieldname: 'status', fieldtype: 'Data' }, { fieldtype: 'Data' }],
            },
            "DocType 'ToDo', fields[1]: `fieldname` must be a non-empty string.",
        ],
        [
            'a field without a fieldtype',
            { name: 'ToDo', module: 'Desk', fields: [{ fieldname: 'status' }] },
            "DocType 'ToDo', fields[0] (status): `fieldtype` must be a non-empty string.",
        ],
        [
            'a field with a bad flag',
            { name: 'ToDo', module: 'Desk', fields: [{ fieldname: 'status', fieldtype: 'Data', reqd: 'yes' }] },
            "DocType 'ToDo', fields[0] (status): `reqd` must be 0, 1 or a boolean.",
        ],
        [
            'a negative permlevel',
            { name: 'ToDo', module: 'Desk', fields: [{ fieldname: 'status', fieldtype: 'Data', permlevel: -1 }] },
            "DocType 'ToDo', fields[0] (status): `permlevel` must be a non-negative integer.",
        ],
        [
            'a fractional permlevel',
            { name: 'ToDo', module: 'Desk', fields: [{ fieldname: 'status', fieldtype: 'Data', permlevel: 1.5 }] },
            "DocType 'ToDo', fields[0] (status): `permlevel` must be a non-negative integer.",
        ],
        [
            'a permlevel that is not a number',
            { name: 'ToDo', module: 'Desk', fields: [{ fieldname: 'status', fieldtype: 'Data', permlevel: '1' }] },
            "DocType 'ToDo', fields[0] (status): `permlevel` must be a non-negative integer.",
        ],
    ])('rejects %s with a TypeError that says where', (_case, raw, message) => {
        expect(() => normalizeDocType(raw)).toThrow(new TypeError(message))
    })
})
