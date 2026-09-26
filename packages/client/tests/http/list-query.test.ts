import { describe, expect, it } from 'vitest'

import { ConfigurationError } from '../../src/errors.js'
import {
    assertPositiveInteger,
    fitsInGet,
    MAX_GET_LENGTH,
    normalizeFilters,
    toListParams,
} from '../../src/http/list-query.js'
import { buildUrl } from '../../src/http/url.js'

describe('normalizeFilters', () => {
    it.each([
        ['nothing', undefined, []],
        ['an empty object', {}, []],
        ['an empty array', [], []],
        ['object equality', { status: 'Open' }, [['status', '=', 'Open']]],
        ['a number', { priority: 2 }, [['priority', '=', 2]]],
        ['null, which Frappe reads as "empty or not set"', { reference_name: null }, [['reference_name', '=', null]]],
        [
            'a boolean',
            { is_group: true, disabled: false },
            [
                ['is_group', '=', 1],
                ['disabled', '=', 0],
            ],
        ],
        ['the object operator form', { priority: ['>', 2] }, [['priority', '>', 2]]],
        [
            'an operator with an array value',
            { status: ['in', ['Open', 'Working']] },
            [['status', 'in', ['Open', 'Working']]],
        ],
        [
            'a pair',
            { creation: ['between', ['2026-01-01', '2026-01-31']] },
            [['creation', 'between', ['2026-01-01', '2026-01-31']]],
        ],
        ['`is`', { description: ['is', 'set'] }, [['description', 'is', 'set']]],
        [
            'several fields, in order',
            { status: 'Open', priority: ['>=', 1] },
            [
                ['status', '=', 'Open'],
                ['priority', '>=', 1],
            ],
        ],
        ['a field set to undefined, which is left out', { status: undefined, priority: 1 }, [['priority', '=', 1]]],
        [
            '3-tuples',
            [
                ['status', '=', 'Open'],
                ['priority', '>', 2],
            ],
            [
                ['status', '=', 'Open'],
                ['priority', '>', 2],
            ],
        ],
        [
            'a 4-tuple on a child table',
            [['Task Depends On', 'task', '=', 'TASK-1']],
            [['Task Depends On', 'task', '=', 'TASK-1']],
        ],
        ['a 4-tuple naming the DocType itself', [['Task', 'status', '=', 'Open']], [['Task', 'status', '=', 'Open']]],
        ['booleans in a tuple', [['is_group', '=', true]], [['is_group', '=', 1]]],
        ['booleans nested in an array', [['is_group', 'in', [true, false]]], [['is_group', 'in', [1, 0]]]],
        ['booleans nested in the object form', { is_group: ['not in', [false]] }, [['is_group', 'not in', [0]]]],
        ['null in a tuple', [['reference_name', '=', null]], [['reference_name', '=', null]]],
    ])('%s', (_title, filters, expected) => {
        expect(normalizeFilters(filters)).toEqual(expected)
    })

    it('does not change the caller’s filters', () => {
        const filters = [['is_group', '=', true]]
        normalizeFilters(filters)
        expect(filters).toEqual([['is_group', '=', true]])
    })

    it.each([
        ['a string', 'status = Open'],
        ['a number', 1],
        ['null', null],
        ['a single tuple instead of an array of tuples', ['status', '=', 'Open']],
    ])('rejects %s', (_title, filters) => {
        expect(() => normalizeFilters(filters)).toThrow(
            new ConfigurationError(
                '`filters` must be an object or an array of arrays such as ["status", "=", "Open"].',
            ),
        )
    })

    it('names the argument in the message', () => {
        expect(() => normalizeFilters('x', '`orFilters`')).toThrow(/^`orFilters` must be/u)
    })
})

describe('toListParams', () => {
    it('sends the first 20 rows when nothing is asked for', () => {
        expect(toListParams({})).toEqual({ limit_start: 0, limit_page_length: 20 })
    })

    it('maps every argument, in order', () => {
        const params = toListParams({
            fields: ['name', 'status'],
            filters: { status: 'Open' },
            orFilters: [['priority', '>', 2]],
            orderBy: { field: 'modified', order: 'desc' },
            groupBy: 'status',
            limit: 50,
            offset: 100,
            parent: 'Task',
        })
        expect(params).toEqual({
            fields: ['name', 'status'],
            filters: [
                ['status', '=', 'Open'],
                ['parenttype', '=', 'Task'],
            ],
            or_filters: [['priority', '>', 2]],
            order_by: 'modified desc',
            group_by: 'status',
            limit_start: 100,
            limit_page_length: 50,
            parent: 'Task',
        })
        expect(Object.keys(params)).toEqual([
            'fields',
            'filters',
            'or_filters',
            'order_by',
            'group_by',
            'limit_start',
            'limit_page_length',
            'parent',
        ])
    })

    it('keeps child rows to the parent DocType given', () => {
        // Frappe 15 returns the rows of every parent type for `parent`; Frappe 16 only this one.
        expect(toListParams({ parent: 'User' })).toEqual({
            filters: [['parenttype', '=', 'User']],
            limit_start: 0,
            limit_page_length: 20,
            parent: 'User',
        })
        expect(toListParams({ filters: [['role', '=', 'System Manager']], parent: 'User' }).filters).toEqual([
            ['role', '=', 'System Manager'],
            ['parenttype', '=', 'User'],
        ])
    })

    it('passes `["*"]` through', () => {
        expect(toListParams({ fields: ['*'] }).fields).toEqual(['*'])
    })

    it('leaves out filters that are empty', () => {
        expect(toListParams({ filters: {}, orFilters: [] })).toEqual({ limit_start: 0, limit_page_length: 20 })
    })

    it('writes one sort field, ascending by default', () => {
        expect(toListParams({ orderBy: { field: 'modified' } }).order_by).toBe('modified asc')
    })

    it('writes several sort fields in priority order', () => {
        expect(toListParams({ orderBy: [{ field: 'priority', order: 'desc' }, { field: 'modified' }] }).order_by).toBe(
            'priority desc, modified asc',
        )
    })

    it('sends no order for an empty list of sort fields', () => {
        expect(toListParams({ orderBy: [] })).not.toHaveProperty('order_by')
    })

    it.each([
        ['a space', 'modified desc'],
        ['SQL', 'name; drop table tabToDo'],
        ['a leading digit', '1name'],
        ['a quote', '`name`'],
        ['an empty string', ''],
        ['a number', 1],
        ['nothing', undefined],
    ])('rejects a sort field with %s', (_title, field) => {
        expect(() => toListParams({ orderBy: { field } })).toThrow(ConfigurationError)
        expect(() => toListParams({ orderBy: { field } })).toThrow(/^`orderBy` field must be a field name/u)
    })

    it('rejects a sort entry that is not an object', () => {
        expect(() => toListParams({ orderBy: ['modified'] })).toThrow(/^`orderBy` field must be a field name/u)
    })

    it.each(['ASC', 'up', 1])('rejects the sort order %s', (order) => {
        expect(() => toListParams({ orderBy: { field: 'modified', order } })).toThrow(
            new ConfigurationError(`\`orderBy\` order must be "asc" or "desc"; got ${String(order)}.`),
        )
    })

    it.each(['status, name', 'status desc', '', 5])('rejects the group field %s', (groupBy) => {
        expect(() => toListParams({ groupBy })).toThrow(/^`groupBy` must be a field name/u)
    })

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '20', null])('rejects the limit %s', (limit) => {
        expect(() => toListParams({ limit })).toThrow(
            new ConfigurationError(`\`limit\` must be a positive integer; got ${String(limit)}.`),
        )
    })

    it.each([-1, 0.5, Number.NaN, '0', null])('rejects the offset %s', (offset) => {
        expect(() => toListParams({ offset })).toThrow(
            new ConfigurationError(`\`offset\` must be an integer of 0 or more; got ${String(offset)}.`),
        )
    })

    it('accepts an offset of 0 and a limit of 1', () => {
        expect(toListParams({ offset: 0, limit: 1 })).toEqual({ limit_start: 0, limit_page_length: 1 })
    })

    it('checks the filters too', () => {
        expect(() => toListParams({ orFilters: 'x' })).toThrow(/^`orFilters` must be/u)
    })
})

describe('assertPositiveInteger', () => {
    it('returns the value', () => {
        expect(assertPositiveInteger(100, '`pageSize`')).toBe(100)
    })

    it('names the argument', () => {
        expect(() => assertPositiveInteger(0, '`pageSize`')).toThrow(
            new ConfigurationError('`pageSize` must be a positive integer; got 0.'),
        )
    })
})

describe('fitsInGet', () => {
    const path = '/api/resource/ToDo'

    /** A query whose path and query string are exactly `length` characters. */
    function queryOfLength(length: number): { filters: string } {
        const overhead = buildUrl('', path, { filters: '' }).length
        return { filters: 'x'.repeat(length - overhead) }
    }

    it('measures the path and the query as they are sent', () => {
        expect(buildUrl('', path, queryOfLength(MAX_GET_LENGTH))).toHaveLength(3800)
    })

    it('fits at exactly 3800 characters, and not at 3801', () => {
        expect(fitsInGet(path, queryOfLength(3800))).toBe(true)
        expect(fitsInGet(path, queryOfLength(3801))).toBe(false)
    })

    it('counts characters once encoded', () => {
        // Each "é" is sent as "%C3%A9": 6 characters.
        const overhead = buildUrl('', path, { filters: '' }).length
        const fits = { filters: 'é'.repeat(Math.floor((3800 - overhead) / 6)) }
        expect(fitsInGet(path, fits)).toBe(true)
        expect(fitsInGet(path, { filters: `${fits.filters}é` })).toBe(false)
    })
})
