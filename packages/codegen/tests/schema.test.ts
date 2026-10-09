import { describe, expect, it } from 'vitest'

import schema from '../schema.json' with { type: 'json' }
import { configFileKeys, DEFAULT_OUT } from '../src/config.js'

describe('schema.json', () => {
    it('lists exactly the keys the config file accepts', () => {
        expect(Object.keys(schema.properties).sort()).toStrictEqual([...configFileKeys].sort())
        expect(schema.additionalProperties).toBe(false)
    })

    it('states the defaults the command uses', () => {
        expect(schema.properties.out.default).toBe(DEFAULT_OUT)
        expect(schema.properties.register.default).toBe(true)
    })
})
