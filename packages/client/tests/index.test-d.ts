import { describe, expectTypeOf, it } from 'vitest'

import { VERSION } from '../src/index.js'

describe('@frappeforge/client types', () => {
    it('exposes VERSION as a string', () => {
        expectTypeOf(VERSION).toEqualTypeOf<string>()
    })
})
