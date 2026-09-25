import { describe, expect, it } from 'vitest'

import {
    AuthenticationError,
    CancelledError,
    ConfigurationError,
    ConflictError,
    FrappeError,
    type FrappeErrorOptions,
    NetworkError,
    NotFoundError,
    PermissionError,
    RateLimitError,
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
    ['ConflictError', ConflictError],
    ['ValidationError', ValidationError],
    ['RateLimitError', RateLimitError],
    ['ServerError', ServerError],
]

const request = { method: 'GET', url: 'https://erp.example.com/api/resource/Task/TASK-0001' }

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

    it('keeps only the origin and path of the request URL', () => {
        const error = new FrappeError('not permitted', {
            request: {
                method: 'GET',
                url: 'https://api:secret@erp.example.com/api/resource/Task?filters=[["owner","=","a@example.com"]]#top',
            },
        })

        expect(error.request).toEqual({ method: 'GET', url: 'https://erp.example.com/api/resource/Task' })
        expect(JSON.stringify(error)).not.toMatch(/secret|owner|top/)
    })

    it('cuts a relative request URL at its query or fragment', () => {
        const query = new FrappeError('x', { request: { method: 'GET', url: '/api/method/ping?token=abc' } })
        const fragment = new FrappeError('x', { request: { method: 'GET', url: '/api/method/ping#abc' } })

        expect(query.request?.url).toBe('/api/method/ping')
        expect(fragment.request?.url).toBe('/api/method/ping')
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
            expect(error.stack?.split('\n')[0]).toBe(`${name}: boom`)
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

describe('RateLimitError', () => {
    it('carries the wait the server asked for', () => {
        const error = new RateLimitError('slow down', { status: 429, retryAfter: 1500 })

        expect(error.retryAfter).toBe(1500)
        expect(error.status).toBe(429)
    })

    it('leaves retryAfter undefined when the server sent none', () => {
        expect(new RateLimitError('slow down').retryAfter).toBeUndefined()
    })
})

describe('JSON serialization', () => {
    it('includes the message, which Error does not make enumerable', () => {
        const error = new NotFoundError('no such Task', { status: 404, request })

        expect(JSON.parse(JSON.stringify(error))).toEqual({
            name: 'NotFoundError',
            message: 'no such Task',
            status: 404,
            serverMessages: [],
            request,
        })
    })

    it('returns every loggable field, including those that are unset', () => {
        const error = new ValidationError('could not save', {
            status: 417,
            exception: 'MandatoryError',
            serverMessages: [{ message: 'Subject is mandatory' }],
        })

        expect(error.toJSON()).toStrictEqual({
            name: 'ValidationError',
            message: 'could not save',
            status: 417,
            exception: 'MandatoryError',
            serverMessages: [{ message: 'Subject is mandatory' }],
            request: undefined,
        })
    })

    it('leaves out the cause and the stack', () => {
        const error = new NetworkError('offline', { cause: new TypeError('fetch failed') })
        const json = JSON.stringify(error)

        expect(json).not.toContain('fetch failed')
        expect(Object.keys(error.toJSON())).not.toContain('cause')
        expect(Object.keys(error.toJSON())).not.toContain('stack')
    })

    it('includes retryAfter for a RateLimitError', () => {
        const error = new RateLimitError('slow down', { status: 429, retryAfter: 1500 })

        expect(JSON.parse(JSON.stringify(error))).toEqual({
            name: 'RateLimitError',
            message: 'slow down',
            status: 429,
            serverMessages: [],
            retryAfter: 1500,
        })
    })
})
