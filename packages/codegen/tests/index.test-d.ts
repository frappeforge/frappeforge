import { describe, expectTypeOf, it } from 'vitest'

import {
    type DocTypeMeta,
    type FieldMeta,
    generate,
    type GenerateOptions,
    type GenerateResult,
    normalizeDocType,
    VERSION,
} from '../src/index.js'

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
