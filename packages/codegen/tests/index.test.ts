import { describe, expect, it } from 'vitest'

import pkg from '../package.json' with { type: 'json' }
import { VERSION } from '../src/index.js'

describe('@frappeforge/codegen', () => {
    it('exposes the package version', () => {
        expect(VERSION).toBe(pkg.version)
    })
})
