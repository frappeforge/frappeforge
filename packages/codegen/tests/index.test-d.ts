import { describe, expectTypeOf, it } from 'vitest'

import { VERSION } from '../src/index.js'

describe('@frappeforge/codegen types', () => {
    it('exposes VERSION as a string', () => {
        expectTypeOf(VERSION).toEqualTypeOf<string>()
    })
})
