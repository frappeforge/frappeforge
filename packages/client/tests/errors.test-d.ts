import { describe, expectTypeOf, it } from 'vitest'

import {
    AuthenticationError,
    CancelledError,
    ConfigurationError,
    ConflictError,
    FrappeError,
    type FrappeErrorJSON,
    NetworkError,
    NotFoundError,
    PermissionError,
    RateLimitError,
    type RateLimitErrorOptions,
    ServerError,
    TimeoutError,
    ValidationError,
} from '../src/errors.js'

describe('error names', () => {
    it('are literal types, so a name check narrows like instanceof', () => {
        expectTypeOf(new FrappeError('x').name).toEqualTypeOf<string>()
        expectTypeOf(new ConfigurationError('x').name).toEqualTypeOf<'ConfigurationError'>()
        expectTypeOf(new NetworkError('x').name).toEqualTypeOf<'NetworkError'>()
        expectTypeOf(new TimeoutError('x').name).toEqualTypeOf<'TimeoutError'>()
        expectTypeOf(new CancelledError('x').name).toEqualTypeOf<'CancelledError'>()
        expectTypeOf(new AuthenticationError('x').name).toEqualTypeOf<'AuthenticationError'>()
        expectTypeOf(new PermissionError('x').name).toEqualTypeOf<'PermissionError'>()
        expectTypeOf(new NotFoundError('x').name).toEqualTypeOf<'NotFoundError'>()
        expectTypeOf(new ConflictError('x').name).toEqualTypeOf<'ConflictError'>()
        expectTypeOf(new ValidationError('x').name).toEqualTypeOf<'ValidationError'>()
        expectTypeOf(new RateLimitError('x').name).toEqualTypeOf<'RateLimitError'>()
        expectTypeOf(new ServerError('x').name).toEqualTypeOf<'ServerError'>()
    })
})

describe('error classes', () => {
    it('are all assignable to FrappeError', () => {
        expectTypeOf<ConflictError>().toExtend<FrappeError>()
        expectTypeOf<RateLimitError>().toExtend<FrappeError>()
        expectTypeOf<ServerError>().toExtend<FrappeError>()
    })

    it('RateLimitError accepts retryAfter and reports it in toJSON', () => {
        expectTypeOf<RateLimitErrorOptions>().toHaveProperty('retryAfter').toEqualTypeOf<number | undefined>()
        expectTypeOf(new RateLimitError('x').retryAfter).toEqualTypeOf<number | undefined>()
        expectTypeOf(new RateLimitError('x').toJSON()).toExtend<FrappeErrorJSON>()
        expectTypeOf(new RateLimitError('x').toJSON().retryAfter).toEqualTypeOf<number | undefined>()
    })

    it('RateLimitError rejects an options object with a mistyped retryAfter', () => {
        // @ts-expect-error `retryAfter` is milliseconds as a number
        const error = new RateLimitError('x', { retryAfter: '1500' })

        expectTypeOf(error).toEqualTypeOf<RateLimitError>()
    })
})
