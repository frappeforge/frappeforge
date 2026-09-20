import { describe, expect, it } from 'vitest'

import {
    AuthenticationError,
    CancelledError,
    ConfigurationError,
    FrappeError,
    type FrappeErrorOptions,
    NetworkError,
    NotFoundError,
    PermissionError,
    ServerError,
    TimeoutError,
    ValidationError,
} from '../src/errors.js'

type FrappeErrorSubclass = new (message: string, options?: FrappeErrorOptions) => FrappeError

const subclasses: readonly (readonly [string, FrappeErrorSubclass])[] = [
    ['ConfigurationError', ConfigurationError],
    ['NetworkError', NetworkError],
    ['TimeoutError', TimeoutError],
    ['CancelledError', CancelledError],
    ['AuthenticationError', AuthenticationError],
    ['PermissionError', PermissionError],
    ['NotFoundError', NotFoundError],
    ['ValidationError', ValidationError],
    ['ServerError', ServerError],
]

describe('FrappeError', () => {
    it('defaults every field that was not supplied', () => {
        const error = new FrappeError('something went wrong')

        expect(error.name).toBe('FrappeError')
        expect(error.message).toBe('something went wrong')
        expect(error.status).toBe(0)
        expect(error.serverMessages).toEqual([])
        expect(error.exception).toBeUndefined()
        expect(error.request).toBeUndefined()
        expect(error.cause).toBeUndefined()
    })

    it('carries every field it is given', () => {
        const cause = new TypeError('socket closed')

        const error = new FrappeError('could not save', {
            status: 417,
            serverMessages: [{ message: 'Subject is mandatory', title: 'Missing field', indicator: 'red' }],
            exception: 'frappe.exceptions.ValidationError',
            request: { method: 'POST', url: 'https://erp.example.com/api/resource/Task' },
            cause,
        })

        expect(error.status).toBe(417)
        expect(error.serverMessages).toEqual([
            { message: 'Subject is mandatory', title: 'Missing field', indicator: 'red' },
        ])
        expect(error.exception).toBe('frappe.exceptions.ValidationError')
        expect(error.request).toEqual({ method: 'POST', url: 'https://erp.example.com/api/resource/Task' })
        expect(error.cause).toBe(cause)
    })

    it('is catchable as an Error', () => {
        expect(() => {
            throw new FrappeError('boom')
        }).toThrow(Error)
    })

    it('keeps a usable stack trace', () => {
        const error = new FrappeError('boom')

        expect(error.stack).toContain('FrappeError')
    })
})

describe('error subclasses', () => {
    for (const [name, Subclass] of subclasses) {
        it(`${name} reports its own name and stays a FrappeError`, () => {
            const error = new Subclass('boom')

            expect(error.name).toBe(name)
            expect(error.message).toBe('boom')
            expect(error.status).toBe(0)
            expect(error).toBeInstanceOf(FrappeError)
            expect(error).toBeInstanceOf(Error)
        })

        it(`${name} forwards the options it is given`, () => {
            const error = new Subclass('boom', {
                status: 503,
                request: { method: 'GET', url: 'https://erp.example.com/api/method/ping' },
            })

            expect(error.status).toBe(503)
            expect(error.request?.url).toBe('https://erp.example.com/api/method/ping')
        })
    }

    it('lets a caller narrow to one kind without reading status codes', () => {
        const thrown: FrappeError = new NotFoundError('no such document', { status: 404 })

        expect(thrown instanceof NotFoundError).toBe(true)
        expect(thrown instanceof PermissionError).toBe(false)
    })
})
