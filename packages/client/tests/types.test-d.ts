import { assertType, describe, expectTypeOf, it } from 'vitest'

import {
    type AuthNamespace,
    type AuthStrategy,
    bearerAuth,
    type BearerAuthOptions,
    createClient,
    type FrappeClient,
    type LoginResult,
    sessionAuth,
    type SessionAuthOptions,
    tokenAuth,
    type TokenAuthOptions,
} from '../src/index.js'
import type {
    AbsentColumn,
    ChildFilterTuple,
    DocInput,
    DocOf,
    DocTypeName,
    EqualityValue,
    FieldOf,
    FieldSelection,
    FilterObject,
    Filters,
    FilterTuple,
    FrappeDoc,
    ListArgs,
    ListFieldOf,
    ListRow,
    QueryValue,
    RawRequest,
    RegisteredDocTypes,
    TableFieldOf,
    UnknownDoc,
} from '../src/types.js'

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
    is_group: 0 | 1
    details?: unknown
    // A field with permlevel > 0: users who cannot read it never receive it (codegen rule B).
    salary?: number
    depends_on: TaskDependsOn[]
}

// An interface written by hand, with an `any` field.
interface Note extends FrappeDoc {
    doctype: 'Note'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the case under test
    meta?: any
}

// An interface, not a type alias: it has no implicit index signature.
interface DocTypes {
    Task: Task
    'Task Depends On': TaskDependsOn
}

type Loose = DocOf<DocTypes, 'Note'>

describe('DocOf', () => {
    it('resolves a known DocType name to its interface', () => {
        expectTypeOf<DocOf<DocTypes, 'Task'>>().toEqualTypeOf<Task>()
    })

    it('falls back to a loose document for a DocType that was not generated', () => {
        expectTypeOf<Loose>().toEqualTypeOf<UnknownDoc>()
        expectTypeOf<Loose['name']>().toEqualTypeOf<string>()
        expectTypeOf<Loose['custom_field']>().toEqualTypeOf<unknown>()
    })

    it('accepts any field of a DocType that was not generated', () => {
        const args = {
            fields: ['name', 'custom_field'],
            filters: { custom_field: 1 },
            orderBy: { field: 'custom_field' },
        } satisfies ListArgs<Loose>

        expectTypeOf(args).toExtend<ListArgs<Loose>>()
    })
})

describe('DocTypeName', () => {
    it('accepts a DocType map declared as an interface', () => {
        expectTypeOf<'Task'>().toExtend<DocTypeName<DocTypes>>()
        expectTypeOf<'Task Depends On'>().toExtend<DocTypeName<DocTypes>>()
    })

    it('accepts any other DocType name too', () => {
        expectTypeOf<'Note'>().toExtend<DocTypeName<DocTypes>>()
    })

    it('resolves to object when no generated types are registered', () => {
        expectTypeOf<RegisteredDocTypes>().toEqualTypeOf<object>()
        expectTypeOf<DocOf<RegisteredDocTypes, 'Task'>>().toEqualTypeOf<UnknownDoc>()
    })
})

describe('fields', () => {
    it('FieldOf includes the document fields and the server-assigned ones', () => {
        expectTypeOf<'subject'>().toExtend<FieldOf<Task>>()
        expectTypeOf<'modified'>().toExtend<FieldOf<Task>>()
    })

    it('TableFieldOf finds the child-table fields', () => {
        expectTypeOf<TableFieldOf<Task>>().toEqualTypeOf<'depends_on'>()
        expectTypeOf<TableFieldOf<Loose>>().toEqualTypeOf<never>()
    })

    it('TableFieldOf does not mistake an `any` field for a table', () => {
        expectTypeOf<TableFieldOf<Note>>().toEqualTypeOf<never>()
        expectTypeOf<'meta'>().toExtend<ListFieldOf<Note>>()
    })

    it('ListFieldOf leaves out the standard columns the table does not have', () => {
        expectTypeOf<AbsentColumn<Task>>().toEqualTypeOf<'parent' | 'parentfield' | 'parenttype'>()
        expectTypeOf<AbsentColumn<TaskDependsOn>>().toEqualTypeOf<
            '_user_tags' | '_comments' | '_assign' | '_liked_by'
        >()
        expectTypeOf<AbsentColumn<Loose>>().toEqualTypeOf<never>()
        expectTypeOf<'parent'>().not.toExtend<ListFieldOf<Task>>()
        expectTypeOf<'parent'>().toExtend<ListFieldOf<TaskDependsOn>>()
        expectTypeOf<'_assign'>().not.toExtend<ListFieldOf<TaskDependsOn>>()
    })

    it('ListFieldOf leaves out tables and doctype, which are not columns', () => {
        expectTypeOf<'subject'>().toExtend<ListFieldOf<Task>>()
        expectTypeOf<'depends_on'>().not.toExtend<ListFieldOf<Task>>()
        expectTypeOf<'doctype'>().not.toExtend<ListFieldOf<Task>>()
    })

    it('the optional standard columns can be requested', () => {
        expectTypeOf<'_assign'>().toExtend<ListFieldOf<Task>>()
        expectTypeOf<'_user_tags'>().toExtend<ListFieldOf<Task>>()
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

    it('accepts several sort fields', () => {
        const args = {
            orderBy: [{ field: 'priority', order: 'desc' }, { field: 'modified' }],
        } satisfies ListArgs<Task>

        expectTypeOf(args).toExtend<ListArgs<Task>>()
    })

    it('accepts every column with *', () => {
        const args = { fields: ['*'] } satisfies ListArgs<Task>

        expectTypeOf(args).toExtend<ListArgs<Task>>()
    })

    it('rejects a field the document does not have', () => {
        // @ts-expect-error `assignee` is not a field of Task
        const args: ListArgs<Task> = { fields: ['assignee'] }

        expectTypeOf(args).toExtend<ListArgs<Task>>()
    })

    it('rejects * combined with other fields', () => {
        // @ts-expect-error `*` stands alone
        const args: ListArgs<Task> = { fields: ['*', 'subject'] }

        expectTypeOf(args).toExtend<ListArgs<Task>>()
    })

    it('rejects an unknown sort direction', () => {
        // @ts-expect-error only `asc` and `desc` are valid
        const args: ListArgs<Task> = { orderBy: { field: 'modified', order: 'sideways' } }

        expectTypeOf(args).toExtend<ListArgs<Task>>()
    })

    it('rejects a table field in fields, orderBy and groupBy', () => {
        // @ts-expect-error lists never return child rows
        const fields: ListArgs<Task> = { fields: ['depends_on'] }
        // @ts-expect-error a table is not a column to sort by
        const orderBy: ListArgs<Task> = { orderBy: { field: 'depends_on' } }
        // @ts-expect-error a table is not a column to group by
        const groupBy: ListArgs<Task> = { groupBy: 'depends_on' }

        expectTypeOf([fields, orderBy, groupBy]).toExtend<ListArgs<Task>[]>()
    })

    it('rejects a standard column the table does not have', () => {
        // @ts-expect-error `parent` exists only on child tables
        const parent: ListArgs<Task> = { fields: ['parent'] }
        // @ts-expect-error `parent` exists only on child tables
        const filter: ListArgs<Task> = { filters: { parent: 'TASK-0001' } }
        // @ts-expect-error `_assign` does not exist on child tables
        const assign: ListArgs<TaskDependsOn> = { fields: ['_assign'] }

        expectTypeOf([parent, filter]).toExtend<ListArgs<Task>[]>()
        expectTypeOf(assign).toExtend<ListArgs<TaskDependsOn>>()
    })

    it('rejects doctype, which is not a column', () => {
        // @ts-expect-error `doctype` is not stored in the table
        const args: ListArgs<Task> = { fields: ['doctype'] }

        expectTypeOf(args).toExtend<ListArgs<Task>>()
    })
})

// A generic `list` signature, as a client method declares it. Its `['name']` default only compiles
// because `FieldSelection` admits `'name'` while `K` is still generic.
declare function list<
    K extends DocTypeName<DocTypes>,
    const F extends FieldSelection<DocOf<DocTypes, K>> = readonly ['name'],
>(doctype: K, args?: ListArgs<DocOf<DocTypes, K>, F>): ListRow<DocOf<DocTypes, K>, F>[]

describe('FieldSelection', () => {
    it('infers the row from the fields of a generic list call', () => {
        expectTypeOf(list('Task')).toEqualTypeOf<{ name: string }[]>()
        expectTypeOf(list('Task', { fields: ['subject', 'priority'] })).toEqualTypeOf<
            { subject: string; priority: number }[]
        >()
        expectTypeOf(list('Task', { fields: ['*'] })).toEqualTypeOf<ListRow<Task, readonly ['*']>[]>()
        expectTypeOf(list('Note', { fields: ['name', 'custom_field'] })).toEqualTypeOf<
            { name: string; custom_field: unknown }[]
        >()
    })

    it('rejects a Select typo at the call site', () => {
        // @ts-expect-error `Opne` is not a status
        const rows = list('Task', { filters: { status: 'Opne' } })

        expectTypeOf(rows).toEqualTypeOf<{ name: string }[]>()
    })
})

describe('ListRow', () => {
    it('narrows to the requested fields; standard columns are present, empty ones as null', () => {
        expectTypeOf<ListRow<Task, readonly ['name', 'subject', 'status', 'details', '_assign']>>().toEqualTypeOf<{
            name: string
            subject: string
            status?: 'Open' | 'Working' | 'Completed' | null
            details?: unknown
            _assign: string | null
        }>()
    })

    it('keeps a field optional when the server may leave it out', () => {
        // Lists drop the fields a user cannot read at their permlevel, so `salary` may be missing.
        expectTypeOf<ListRow<Task, readonly ['salary']>>().toEqualTypeOf<{ salary?: number }>()
        expectTypeOf<Pick<ListRow<Task, readonly ['*']>, 'salary'>>().toEqualTypeOf<{ salary?: number }>()
    })

    it('gives a loose row for a DocType that was not generated', () => {
        expectTypeOf<ListRow<Loose, readonly ['name', 'custom_field']>>().toEqualTypeOf<{
            name: string
            custom_field: unknown
        }>()
    })

    it('with *, every column appears except tables and doctype', () => {
        type Row = ListRow<Task, readonly ['*']>

        expectTypeOf<Row['subject']>().toEqualTypeOf<string>()
        expectTypeOf<Row['priority']>().toEqualTypeOf<number>()
        expectTypeOf<Row['name']>().toEqualTypeOf<string>()
        expectTypeOf<Row>().toHaveProperty('status')
        expectTypeOf<'depends_on' extends keyof Row ? true : false>().toEqualTypeOf<false>()
        expectTypeOf<'doctype' extends keyof Row ? true : false>().toEqualTypeOf<false>()
        // Required fields and standard columns are required; the rest keep the interface's `?`.
        expectTypeOf<Pick<Row, 'subject' | 'modified'>>().toEqualTypeOf<{ subject: string; modified: string }>()
        expectTypeOf<Pick<Row, 'status'>>().toEqualTypeOf<{ status?: 'Open' | 'Working' | 'Completed' | null }>()
    })

    it('with *, child rows have parent…, and no row has _user_tags, _comments, _assign or _liked_by', () => {
        type ParentRow = ListRow<Task, readonly ['*']>
        type ChildRow = ListRow<TaskDependsOn, readonly ['*']>

        // Frappe expands `*` to the default and permitted fields, which never include those four.
        expectTypeOf<'parent' extends keyof ParentRow ? true : false>().toEqualTypeOf<false>()
        expectTypeOf<'_assign' extends keyof ParentRow ? true : false>().toEqualTypeOf<false>()
        expectTypeOf<'_user_tags' extends keyof ParentRow ? true : false>().toEqualTypeOf<false>()
        expectTypeOf<Pick<ChildRow, 'parent' | 'parenttype'>>().toEqualTypeOf<{ parent: string; parenttype: string }>()
        expectTypeOf<'_assign' extends keyof ChildRow ? true : false>().toEqualTypeOf<false>()
    })

    it('_assign and the like come back when asked for by name', () => {
        expectTypeOf<ListRow<Task, readonly ['_assign', '_liked_by']>>().toEqualTypeOf<{
            _assign: string | null
            _liked_by: string | null
        }>()
    })

    it('with * on a DocType that was not generated, _assign and the like are not promised', () => {
        type Row = ListRow<Loose, readonly ['*']>

        expectTypeOf<Row['_assign']>().toEqualTypeOf<unknown>()
    })

    it('with * on a DocType that was not generated, standard columns keep their types', () => {
        type Row = ListRow<Loose, readonly ['*']>

        expectTypeOf<Row['name']>().toEqualTypeOf<string>()
        expectTypeOf<Row['docstatus']>().toEqualTypeOf<0 | 1 | 2>()
        expectTypeOf<Row['custom_field']>().toEqualTypeOf<unknown>()
    })
})

describe('Filters — object form', () => {
    it('accepts equality values checked against each field', () => {
        const filters = {
            status: 'Open',
            priority: 2,
            is_group: true,
            details: 'anything',
            subject: null,
        } satisfies Filters<Task>

        expectTypeOf(filters).toExtend<FilterObject<Task>>()
    })

    it('accepts [operator, value], including in with an array', () => {
        const filters = {
            status: ['in', ['Open', 'Working']],
            priority: ['>', 2],
        } satisfies Filters<Task>

        expectTypeOf(filters).toExtend<FilterObject<Task>>()
    })

    it('rejects a bare array, which Frappe reads as [operator, value]', () => {
        // @ts-expect-error Frappe would read `Open` as the operator
        const filters: Filters<Task> = { status: ['Open', 'Completed'] }

        expectTypeOf(filters).toExtend<Filters<Task>>()
    })

    it('rejects a value the field cannot hold', () => {
        // @ts-expect-error `Opne` is not a status
        const typo: Filters<Task> = { status: 'Opne' }
        // @ts-expect-error `priority` is a number
        const text: Filters<Task> = { priority: 'high' }

        expectTypeOf([typo, text]).toExtend<Filters<Task>[]>()
    })

    it('rejects a field the document does not have', () => {
        // @ts-expect-error `assignee` is not a field of Task
        const unknownField: Filters<Task> = { assignee: 'someone@example.com' }

        expectTypeOf(unknownField).toExtend<Filters<Task>>()
    })

    it('rejects a table field', () => {
        // @ts-expect-error a table is not a column to filter on
        const filters: Filters<Task> = { depends_on: 'TASK-0001' }

        expectTypeOf(filters).toExtend<Filters<Task>>()
    })

    it('checks the standard columns of a DocType that was not generated', () => {
        const filters = { docstatus: 1, custom_field: 'anything' } satisfies Filters<Loose>
        // @ts-expect-error `docstatus` is 0, 1 or 2
        const docstatus: Filters<Loose> = { docstatus: 7 }

        expectTypeOf([filters, docstatus]).toExtend<Filters<Loose>[]>()
    })

    it('EqualityValue follows the field type', () => {
        expectTypeOf<EqualityValue<Task['status']>>().toEqualTypeOf<'Open' | 'Working' | 'Completed' | null>()
        expectTypeOf<EqualityValue<Task['is_group']>>().toEqualTypeOf<boolean | 0 | 1>()
        expectTypeOf<EqualityValue<Task['priority']>>().toEqualTypeOf<number | null>()
        expectTypeOf<EqualityValue<unknown>>().toEqualTypeOf<string | number | boolean | null>()
    })
})

describe('Filters — tuple form', () => {
    it('accepts operator tuples', () => {
        const filters = [['priority', '>', 2]] satisfies Filters<Task>

        expectTypeOf(filters).toExtend<Filters<Task>>()
    })

    it('accepts every operator with the value it expects', () => {
        const filters = [
            ['status', '=', 'Open'],
            ['status', '!=', 'Completed'],
            ['priority', '>=', 1],
            ['subject', 'like', '%release%'],
            ['subject', 'not like', '%draft%'],
            ['status', 'in', ['Open', 'Working']],
            ['status', 'not in', ['Completed']],
            ['subject', 'is', 'set'],
            ['subject', 'is', 'not set'],
            ['priority', 'between', [1, 5]],
            ['creation', 'between', ['2026-01-01', '2026-12-31']],
            ['creation', 'timespan', 'last 30 days'],
            ['modified', 'timespan', 'this quarter'],
            ['name', 'descendants of', 'TASK-0001'],
            ['name', 'not ancestors of', 'TASK-0002'],
        ] satisfies Filters<Task>

        expectTypeOf(filters).toExtend<Filters<Task>>()
    })

    it('rejects a value that does not fit the operator', () => {
        // @ts-expect-error `is` takes `set` or `not set`
        const is: FilterTuple<Task> = ['subject', 'is', 'maybe']
        // @ts-expect-error `between` takes a pair
        const between: FilterTuple<Task> = ['priority', 'between', 5]
        // @ts-expect-error `in` takes an array
        const inList: FilterTuple<Task> = ['status', 'in', 'Open']
        // @ts-expect-error not a Frappe timespan
        const timespan: FilterTuple<Task> = ['creation', 'timespan', 'last decade']
        // @ts-expect-error Frappe has no `<>` operator; use `!=`
        const notEqual: FilterTuple<Task> = ['status', '<>', 'Completed']

        expectTypeOf([is, between, inList, timespan, notEqual]).toExtend<FilterTuple<Task>[]>()
    })

    it('accepts child-table 4-tuples', () => {
        const filters = [
            ['Task Depends On', 'task', '=', 'TASK-0001'],
            ['status', '=', 'Open'],
        ] satisfies Filters<Task>

        expectTypeOf(filters).toExtend<Filters<Task>>()
        expectTypeOf<ChildFilterTuple<Task>>().toExtend<FilterTuple<Task>>()
    })

    it('accepts a 4-tuple naming the DocType itself, as Desk writes them', () => {
        const filters = [['Task', 'status', '=', 'Open']] satisfies Filters<Task>

        expectTypeOf(filters).toExtend<Filters<Task>>()
    })

    it('rejects a 4-tuple naming the DocType itself with a field it does not have', () => {
        // @ts-expect-error `nope` is not a field of Task
        const filter: FilterTuple<Task> = ['Task', 'nope', '=', 1]

        expectTypeOf(filter).toExtend<FilterTuple<Task>>()
    })

    it('rejects an unknown child field or a DocType that is not a child table', () => {
        // @ts-expect-error `nope` is not a field of Task Depends On
        const field: FilterTuple<Task> = ['Task Depends On', 'nope', '=', 1]
        // @ts-expect-error `Note` is not a child table of Task
        const doctype: FilterTuple<Task> = ['Note', 'task', '=', 1]

        expectTypeOf([field, doctype]).toExtend<FilterTuple<Task>[]>()
    })

    it('accepts any 3- or 4-tuple for a DocType that was not generated', () => {
        const filters = [
            ['custom_field', '=', 1],
            ['Some Child', 'field', 'is', 'set'],
        ] satisfies Filters<Loose>

        expectTypeOf(filters).toExtend<Filters<Loose>>()
    })

    it('rejects a table field', () => {
        // @ts-expect-error a table is not a column to filter on
        const filters: Filters<Task> = [['depends_on', '=', 'TASK-0001']]

        expectTypeOf(filters).toExtend<Filters<Task>>()
    })
})

describe('DocInput', () => {
    it('accepts every field as optional, with child rows in the same shape', () => {
        const input = {
            subject: 'Ship 1.0',
            status: null,
            depends_on: [{ name: 'row-1', task: 'TASK-0001' }, { task: 'TASK-0002' }],
        } satisfies DocInput<Task>

        expectTypeOf(input).toExtend<DocInput<Task>>()
        expectTypeOf<{ name: 'TASK-0001' }>().toExtend<DocInput<Task>>()
        expectTypeOf({} satisfies DocInput<Task>).toExtend<DocInput<Task>>()
    })

    it('rejects server-assigned fields and docstatus', () => {
        // @ts-expect-error `modified` is assigned by the server
        const modified: DocInput<Task> = { modified: '2026-01-01 00:00:00' }
        // @ts-expect-error `docstatus` changes through submit and cancel
        const docstatus: DocInput<Task> = { docstatus: 1 }
        // @ts-expect-error child rows get parent from the document they are saved with
        const parent: DocInput<Task> = { depends_on: [{ parent: 'TASK-0001' }] }

        expectTypeOf([modified, docstatus, parent]).toExtend<DocInput<Task>[]>()
    })

    it('rejects wrong values, unknown fields and undefined', () => {
        // @ts-expect-error child row values are checked
        const child: DocInput<Task> = { depends_on: [{ task: 5 }] }
        // @ts-expect-error `subjct` is not a field of Task
        const typo: DocInput<Task> = { subjct: 'Ship 1.0' }
        // @ts-expect-error JSON has no undefined; omit the field instead
        const missing: DocInput<Task> = { status: undefined }

        expectTypeOf([child, typo, missing]).toExtend<DocInput<Task>[]>()
    })

    it('accepts any field for a DocType that was not generated', () => {
        const input = { custom_field: 1, name: 'NOTE-1' } satisfies DocInput<Loose>

        expectTypeOf(input).toExtend<DocInput<Loose>>()
    })
})

describe('request', () => {
    const frappe = createClient({ url: 'https://example.com' })

    it('returns Promise<unknown> by default and Promise<T> when asked', () => {
        expectTypeOf(createClient).returns.toEqualTypeOf<FrappeClient>()
        expectTypeOf(frappe.request({ path: '/api/method/frappe.ping' })).toEqualTypeOf<Promise<unknown>>()
        expectTypeOf(frappe.request<Task>({ path: '/api/resource/Task/T-1' })).toEqualTypeOf<Promise<Task>>()
    })

    it('accepts only the methods Frappe routes', () => {
        expectTypeOf<NonNullable<RawRequest['method']>>().toEqualTypeOf<'GET' | 'POST' | 'PUT' | 'DELETE'>()
        // @ts-expect-error Frappe has no PATCH route
        void frappe.request({ method: 'PATCH', path: '/api/resource/Task/T-1' })
        // @ts-expect-error path is required
        void frappe.request({ method: 'GET' })
    })

    it('accepts every documented query value', () => {
        const query = {
            text: 'a',
            count: 1,
            flag: true,
            none: null,
            missing: undefined,
            list: ['name', 'status'],
            filters: { status: 'Open' },
        } satisfies Record<string, QueryValue>
        expectTypeOf(query).toExtend<RawRequest['query']>()
        // @ts-expect-error a symbol cannot be encoded
        assertType<QueryValue>(Symbol('x'))
    })
})

describe('auth', () => {
    it('lets a minimal object literal implement AuthStrategy', () => {
        const minimal = {
            apply() {
                // nothing to do
            },
        } satisfies AuthStrategy
        expectTypeOf(minimal).toExtend<AuthStrategy>()
        const asyncOne: AuthStrategy = {
            async apply(headers, method) {
                expectTypeOf(headers).toEqualTypeOf<Headers>()
                expectTypeOf(method).toEqualTypeOf<string>()
                await Promise.resolve()
            },
            onUnauthorized: async (request) => {
                expectTypeOf(request).toEqualTypeOf<Request>()
                return Promise.resolve(true)
            },
        }
        expectTypeOf(asyncOne).toExtend<AuthStrategy>()
    })

    it('lets a class implement AuthStrategy', () => {
        class Vault implements AuthStrategy {
            readonly credentials = 'omit'
            apply(headers: Headers): void {
                headers.set('Authorization', 'token a:b')
            }
            clear(): void {
                // nothing to do
            }
        }
        expectTypeOf(new Vault()).toExtend<AuthStrategy>()
    })

    it('spells out the credentials modes', () => {
        expectTypeOf<NonNullable<AuthStrategy['credentials']>>().toEqualTypeOf<'include' | 'omit' | 'same-origin'>()
        const apply = (): void => undefined
        // @ts-expect-error not a credentials mode
        assertType<AuthStrategy>({ apply, credentials: 'always' })
    })

    it('returns an AuthStrategy from every strategy, with typed options', () => {
        expectTypeOf(tokenAuth).returns.toEqualTypeOf<AuthStrategy>()
        expectTypeOf(bearerAuth).returns.toEqualTypeOf<AuthStrategy>()
        expectTypeOf(sessionAuth).returns.toEqualTypeOf<AuthStrategy>()
        expectTypeOf(tokenAuth).parameter(0).toEqualTypeOf<TokenAuthOptions>()
        expectTypeOf<BearerAuthOptions['token']>().toEqualTypeOf<string | (() => string | Promise<string>)>()
        expectTypeOf<SessionAuthOptions['csrfToken']>().toEqualTypeOf<string | (() => string | undefined) | undefined>()
        bearerAuth({ token: async () => Promise.resolve('abc'), refresh: async () => Promise.resolve(true) })
        sessionAuth()
        // @ts-expect-error the secret is required
        tokenAuth({ apiKey: 'key' })
    })

    it('types the auth namespace', () => {
        const frappe = createClient({ url: 'https://example.com', auth: sessionAuth() })
        expectTypeOf(frappe.auth).toEqualTypeOf<AuthNamespace>()
        expectTypeOf(frappe.auth.login({ username: 'a', password: 'b' })).toEqualTypeOf<Promise<LoginResult>>()
        expectTypeOf<LoginResult>().toEqualTypeOf<{ fullName: string; homePage: string }>()
        expectTypeOf(frappe.auth.logout()).toEqualTypeOf<Promise<void>>()
        expectTypeOf(frappe.auth.currentUser()).toEqualTypeOf<Promise<string | null>>()
        // @ts-expect-error a password is required
        void frappe.auth.login({ username: 'a' })
    })
})
