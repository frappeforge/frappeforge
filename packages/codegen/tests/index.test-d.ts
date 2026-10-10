import { createClient } from '@frappeforge/client'
import { describe, expectTypeOf, it } from 'vitest'

import {
    type DocTypeMeta,
    type FieldMeta,
    generate,
    type GenerateOptions,
    type GenerateResult,
    loadFromBench,
    loadFromSite,
    type LoadFromSiteResult,
    normalizeDocType,
    VERSION,
} from '../src/index.js'
import type { DocTypes as V16DocTypes } from './golden/v16.generated.js'

describe('@frappeforge/codegen types', () => {
    it('exposes VERSION as a string', () => {
        expectTypeOf(VERSION).toEqualTypeOf<string>()
    })

    it('normalizes any value into DocType metadata', () => {
        expectTypeOf(normalizeDocType).parameter(0).toBeUnknown()
        expectTypeOf(normalizeDocType).returns.toEqualTypeOf<DocTypeMeta>()
        expectTypeOf<DocTypeMeta['fields']>().toEqualTypeOf<readonly FieldMeta[]>()
    })

    it('generates from read-only metadata, with optional options', () => {
        expectTypeOf(generate).parameter(0).toEqualTypeOf<readonly DocTypeMeta[]>()
        expectTypeOf(generate).parameter(1).toEqualTypeOf<GenerateOptions | undefined>()
        expectTypeOf(generate).returns.toEqualTypeOf<GenerateResult>()
        expectTypeOf<GenerateResult['warnings']>().toEqualTypeOf<readonly string[]>()
    })

    it('accepts only known options with their types', () => {
        expectTypeOf<{ register: false; rename: { Item: 'ErpItem' } }>().toExtend<GenerateOptions>()
        expectTypeOf<{ register: 'yes' }>().not.toExtend<GenerateOptions>()
        // @ts-expect-error `renames` is not an option
        const options: GenerateOptions = { renames: {} }
        expectTypeOf(options).toEqualTypeOf<GenerateOptions>()
    })

    it('reads from any client, typed with DocTypes or not', () => {
        const url = 'https://example.com'
        expectTypeOf(loadFromSite).returns.toEqualTypeOf<Promise<LoadFromSiteResult>>()
        expectTypeOf<LoadFromSiteResult>().toEqualTypeOf<{ docTypes: DocTypeMeta[]; warnings: readonly string[] }>()
        // Typed through `Register`, which the generated test module augments.
        expectTypeOf(loadFromSite).toBeCallableWith(createClient({ url }), { doctypes: ['ToDo'] })
        expectTypeOf(loadFromSite).toBeCallableWith(createClient<V16DocTypes>({ url }), { modules: ['Selling'] })
        expectTypeOf(loadFromSite).toBeCallableWith(createClient<object>({ url }), { apps: ['erpnext'] })
        expectTypeOf(loadFromSite).toBeCallableWith(createClient({ url }), {})
    })

    it('selects by DocType, module and app names only', () => {
        const frappe = createClient({ url: 'https://example.com' })
        const doctypes: readonly string[] = ['ToDo']
        expectTypeOf(loadFromSite).toBeCallableWith(frappe, { doctypes, modules: doctypes, apps: doctypes })
        // @ts-expect-error `doctype` is not a selection key
        void loadFromSite(frappe, { doctype: ['ToDo'] })
        // @ts-expect-error names are strings
        void loadFromSite(frappe, { modules: [1] })
    })

    it('reads a bench by its directory, with the same selection as a site', () => {
        expectTypeOf(loadFromBench).parameter(0).toEqualTypeOf<string>()
        expectTypeOf(loadFromBench).returns.toEqualTypeOf<Promise<DocTypeMeta[]>>()
        expectTypeOf(loadFromBench).parameter(1).toEqualTypeOf<Parameters<typeof loadFromSite>[1]>()
        // @ts-expect-error the selection is required, as for a site
        void loadFromBench('../frappe-bench')
    })

    it('keeps optional metadata absent rather than undefined', () => {
        expectTypeOf<{
            fieldname: string
            fieldtype: string
            label: undefined
            reqd: boolean
            permlevel: number
            is_virtual: boolean
            mask: boolean
        }>().not.toExtend<FieldMeta>()
    })
})
