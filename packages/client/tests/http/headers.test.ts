import { describe, expect, it } from 'vitest'

import { SafeHeaders } from '../../src/http/headers.js'
import { exposed } from '../support/expose.js'

const SECRET = 'SECRET3a8f71'

/** What `run` throws. */
function thrown(run: () => void): unknown {
    try {
        run()
    } catch (error) {
        return error
    }
    throw new Error('expected a throw')
}

describe('SafeHeaders', () => {
    it('sets and appends valid headers like Headers', () => {
        const headers = new SafeHeaders({ Accept: 'application/json' })
        headers.set('Authorization', 'token key:secret')
        headers.append('Cookie', 'a=1')
        expect(headers).toBeInstanceOf(Headers)
        expect(Object.fromEntries(headers)).toEqual({
            accept: 'application/json',
            authorization: 'token key:secret',
            cookie: 'a=1',
        })
    })

    it.each(['set', 'append'] as const)('%s names the header whose value is invalid, never quoting it', (method) => {
        const error = thrown(() => {
            new SafeHeaders()[method]('Authorization', `token key:${SECRET}\u0000`)
        })
        expect(error).toBeInstanceOf(TypeError)
        expect(error).toMatchObject({ message: 'The "Authorization" header has an invalid value.' })
        expect(exposed(error)).not.toContain(SECRET)
    })

    it.each(['set', 'append'] as const)('%s never quotes an invalid name, which may be a misplaced value', (method) => {
        const error = thrown(() => {
            new SafeHeaders()[method](`token key:${SECRET}`, 'x')
        })
        expect(error).toBeInstanceOf(TypeError)
        expect(error).toMatchObject({ message: 'A header has an invalid name.' })
        expect(exposed(error)).not.toContain(SECRET)
    })

    it('shows that the runtime alone quotes the value, which is why the class exists', () => {
        const error = thrown(() => {
            new Headers().set('Authorization', `token key:${SECRET}\u0000`)
        })
        expect(exposed(error)).toContain(SECRET)
    })
})
