import { describe, expect, it, vi } from 'vitest'

import {
    AuthenticationError,
    type AuthStrategy,
    bearerAuth,
    ConfigurationError,
    createClient,
} from '../../src/index.js'
import { deferred, exposed } from '../support/expose.js'
import { json, stubFetch } from '../support/fetch.js'

const url = 'https://example.com'
const path = '/api/method/frappe.auth.get_logged_user'
const SECRET = 'SECRET9f2c'

/** Wraps a strategy to count the 401s that reached `onUnauthorized`. */
function counted(strategy: AuthStrategy): { auth: AuthStrategy; waiting: () => number } {
    let waiting = 0
    const auth: AuthStrategy = {
        apply: async (headers, method) => strategy.apply(headers, method),
        onUnauthorized: async (request) => {
            waiting += 1
            return (await strategy.onUnauthorized?.(request)) ?? false
        },
    }
    return { auth, waiting: () => waiting }
}

/** A site that accepts only `Bearer <valid()>`, and records every Authorization it receives. */
function site(valid: () => string, answer: (request: Request) => Promise<Response> | undefined = () => undefined) {
    const sent: (string | null)[] = []
    const fetch = async (request: Request): Promise<Response> => {
        sent.push(request.headers.get('authorization'))
        const custom = answer(request)
        if (custom !== undefined) return custom
        return request.headers.get('authorization') === `Bearer ${valid()}`
            ? json(200, { message: 'Administrator' })
            : json(401, { exc_type: 'AuthenticationError' })
    }
    return { fetch, sent }
}

describe('bearerAuth: the token', () => {
    it('sends a fixed string', async () => {
        const { fetch, sent } = site(() => 'abc')
        const frappe = createClient({ url, fetch, auth: bearerAuth({ token: 'abc' }) })
        await expect(frappe.request({ path })).resolves.toEqual({ message: 'Administrator' })
        expect(sent).toEqual(['Bearer abc'])
    })

    it('calls a sync or async getter before every request', async () => {
        let current = 'one'
        const sync = vi.fn(() => current)
        const asyncGetter = vi.fn(async () => Promise.resolve(current))
        for (const token of [sync, asyncGetter]) {
            current = 'one'
            const { fetch, sent } = site(() => current)
            const frappe = createClient({ url, fetch, auth: bearerAuth({ token }) })
            await frappe.request({ path })
            current = 'two'
            await frappe.request({ path })
            expect(sent).toEqual(['Bearer one', 'Bearer two'])
            expect(token).toHaveBeenCalledTimes(2)
        }
    })

    it.each([[''], ['has space'], [`${SECRET}\u0000`], [42], [undefined]])(
        'rejects a getter result of %j with a ConfigurationError, before any request',
        async (value) => {
            const { fetch, sent } = site(() => 'abc')
            const frappe = createClient({ url, fetch, auth: bearerAuth({ token: () => value as string }) })
            const error = await frappe.request({ path }).catch((reason: unknown) => reason)
            expect(error).toBeInstanceOf(ConfigurationError)
            expect(exposed(error)).not.toContain(SECRET)
            expect(sent).toEqual([])
        },
    )

    it('passes an error thrown by the getter through unchanged', async () => {
        const failure = new Error('vault is sealed')
        const { fetch, sent } = site(() => 'abc')
        const frappe = createClient({
            url,
            fetch,
            auth: bearerAuth({
                token: () => {
                    throw failure
                },
            }),
        })
        await expect(frappe.request({ path })).rejects.toBe(failure)
        expect(sent).toEqual([])
    })

    it.each([
        ['a missing token', {}],
        ['an empty token', { token: '' }],
        ['a token with a space', { token: `${SECRET} x` }],
        ['a token that is neither a string nor a function', { token: 42 }],
        ['a refresh that is not a function', { token: () => 'abc', refresh: true }],
        ['a refresh with a fixed token, which cannot change', { token: 'abc', refresh: () => true }],
    ])('rejects %s', (_title, options) => {
        let error: unknown
        try {
            bearerAuth(options as never)
        } catch (caught) {
            error = caught
        }
        expect(error).toBeInstanceOf(ConfigurationError)
        expect(exposed(error)).not.toContain(SECRET)
    })

    it('rejects missing options', () => {
        expect(() => bearerAuth(undefined as never)).toThrow(ConfigurationError)
    })
})

describe('bearerAuth: refresh', () => {
    it('has no onUnauthorized without refresh, so a 401 surfaces after one request', async () => {
        const strategy = bearerAuth({ token: 'old' })
        expect('onUnauthorized' in strategy).toBe(false)
        const { fetch, sent } = site(() => 'new')
        const frappe = createClient({ url, fetch, auth: strategy })
        await expect(frappe.request({ path })).rejects.toBeInstanceOf(AuthenticationError)
        expect(sent).toEqual(['Bearer old'])
    })

    it('refreshes on a 401 and sends the request once more with the new token', async () => {
        let current = 'old'
        const refresh = vi.fn(() => {
            current = 'new'
            return true
        })
        const { fetch, sent } = site(() => 'new')
        const frappe = createClient({ url, fetch, auth: bearerAuth({ token: () => current, refresh }) })
        await expect(frappe.request({ path })).resolves.toEqual({ message: 'Administrator' })
        expect(sent).toEqual(['Bearer old', 'Bearer new'])
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('surfaces the 401 when refresh resolves false', async () => {
        const refresh = vi.fn(async () => Promise.resolve(false))
        const { fetch, sent } = site(() => 'new')
        const frappe = createClient({ url, fetch, auth: bearerAuth({ token: () => 'old', refresh }) })
        await expect(frappe.request({ path })).rejects.toBeInstanceOf(AuthenticationError)
        expect(sent).toEqual(['Bearer old'])
    })

    it('does not refresh again when the replay is also a 401', async () => {
        let current = 'old'
        const refresh = vi.fn(() => {
            current = 'still-bad'
            return true
        })
        const { fetch, sent } = site(() => 'new')
        const frappe = createClient({ url, fetch, auth: bearerAuth({ token: () => current, refresh }) })
        await expect(frappe.request({ path })).rejects.toBeInstanceOf(AuthenticationError)
        expect(sent).toEqual(['Bearer old', 'Bearer still-bad'])
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('refreshes once for 10 concurrent 401s, and replays each with the new token', async () => {
        let current = 'old'
        const renewed = deferred<boolean>()
        const refresh = vi.fn(async () => {
            const result = await renewed.promise
            current = 'new'
            return result
        })
        const { fetch, sent } = site(() => 'new')
        const { auth, waiting } = counted(bearerAuth({ token: () => current, refresh }))
        const frappe = createClient({ url, fetch, auth })

        const results = Promise.all(Array.from({ length: 10 }, () => frappe.request({ path })))
        await vi.waitFor(() => {
            expect(waiting()).toBe(10)
        })
        expect(refresh).toHaveBeenCalledTimes(1)
        renewed.resolve(true)

        expect(await results).toEqual(Array.from({ length: 10 }, () => ({ message: 'Administrator' })))
        expect(refresh).toHaveBeenCalledTimes(1)
        expect(sent).toHaveLength(20)
        expect(sent.slice(10)).toEqual(Array.from({ length: 10 }, () => 'Bearer new'))
    })

    it('does not refresh again for a 401 that arrives after the refresh, for a replaced token', async () => {
        let current = 'old'
        const refresh = vi.fn(() => {
            current = 'new'
            return true
        })
        const late = deferred<Response>()
        const { fetch, sent } = site(
            () => 'new',
            (request) =>
                new URL(request.url).pathname === '/api/slow' && request.headers.get('authorization') === 'Bearer old'
                    ? late.promise
                    : undefined,
        )
        const frappe = createClient({ url, fetch, auth: bearerAuth({ token: () => current, refresh }) })

        const slow = frappe.request({ path: '/api/slow' })
        await expect(frappe.request({ path })).resolves.toEqual({ message: 'Administrator' })
        expect(refresh).toHaveBeenCalledTimes(1)
        // Sent with the old token, answered only now.
        late.resolve(json(401, { exc_type: 'AuthenticationError' }))

        await expect(slow).resolves.toEqual({ message: 'Administrator' })
        expect(refresh).toHaveBeenCalledTimes(1)
        expect(sent).toEqual(['Bearer old', 'Bearer old', 'Bearer new', 'Bearer new'])
    })

    it('rejects every waiting request with the error refresh threw, and refreshes again later', async () => {
        const failure = new Error('token endpoint is down')
        const renewed = deferred<boolean>()
        let calls = 0
        const refresh = async (): Promise<boolean> => {
            calls += 1
            return calls === 1 ? renewed.promise : false
        }
        const { fetch } = site(() => 'new')
        const { auth, waiting } = counted(bearerAuth({ token: () => 'old', refresh }))
        const frappe = createClient({ url, fetch, auth })

        const results = Promise.allSettled(Array.from({ length: 10 }, () => frappe.request({ path })))
        await vi.waitFor(() => {
            expect(waiting()).toBe(10)
        })
        renewed.reject(failure)
        const settled = await results
        expect(settled.every((result) => result.status === 'rejected' && result.reason === failure)).toBe(true)
        expect(calls).toBe(1)

        await expect(frappe.request({ path })).rejects.toBeInstanceOf(AuthenticationError)
        expect(calls).toBe(2)
    })

    it('turns a refresh that throws synchronously into a rejection', async () => {
        const failure = new Error('no refresh token')
        const { fetch } = site(() => 'new')
        const frappe = createClient({
            url,
            fetch,
            auth: bearerAuth({
                token: () => 'old',
                refresh: () => {
                    throw failure
                },
            }),
        })
        await expect(frappe.request({ path })).rejects.toBe(failure)
    })
})

describe('bearerAuth: a token read that overlaps a refresh', () => {
    const sentWith = (token: string): Request => new Request(url, { headers: { Authorization: `Bearer ${token}` } })

    /** A getter whose first read is slow: it reads the token at once, and returns it when `release` resolves. */
    function slowFirstRead(read: () => string) {
        const release = deferred<undefined>()
        let reads = 0
        const token = (): string | Promise<string> => {
            reads += 1
            const value = read()
            return reads === 1 ? release.promise.then(() => value) : value
        }
        return { token, release }
    }

    it.each([true, false])(
        'does not refresh again for a 401 whose token read ended after a refresh that resolved %s',
        async (outcome) => {
            let current = 'old'
            const refresh = vi.fn(() => {
                current = 'new'
                return outcome
            })
            const { token, release } = slowFirstRead(() => current)
            const strategy = bearerAuth({ token, refresh })
            const onUnauthorized = strategy.onUnauthorized?.bind(strategy)
            // X reads "old" before the refresh and resumes only after it has settled.
            const x = onUnauthorized?.(sentWith('old'))
            await expect(onUnauthorized?.(sentWith('old'))).resolves.toBe(outcome)
            release.resolve(undefined)
            await expect(x).resolves.toBe(outcome)
            expect(refresh).toHaveBeenCalledTimes(1)
        },
    )

    it('joins a refresh that started while its token read was pending', async () => {
        let current = 'old'
        const renewed = deferred<boolean>()
        const refresh = vi.fn(async () => {
            const result = await renewed.promise
            current = 'new'
            return result
        })
        const { token, release } = slowFirstRead(() => current)
        const strategy = bearerAuth({ token, refresh })
        const onUnauthorized = strategy.onUnauthorized?.bind(strategy)
        const x = onUnauthorized?.(sentWith('old'))
        const y = onUnauthorized?.(sentWith('old'))
        await vi.waitFor(() => {
            expect(refresh).toHaveBeenCalledTimes(1)
        })
        release.resolve(undefined)
        await Promise.resolve()
        renewed.resolve(true)
        await expect(Promise.all([x, y])).resolves.toEqual([true, true])
        expect(refresh).toHaveBeenCalledTimes(1)
    })
})

describe('bearerAuth: no usable token after a 401', () => {
    it.each([
        ['returns an empty string', () => ''],
        [
            'throws',
            () => {
                throw new Error('signed out')
            },
        ],
    ])('surfaces the 401 as AuthenticationError, without refreshing, when the getter now %s', async (_case, after) => {
        let signedOut = false
        const refresh = vi.fn(() => true)
        const { fetch, sent } = site(
            () => 'new',
            () => {
                // The app signs out while the request is in flight.
                signedOut = true
                return undefined
            },
        )
        const token = (): string => (signedOut ? after() : 'old')
        const frappe = createClient({ url, fetch, auth: bearerAuth({ token, refresh }) })
        await expect(frappe.request({ path })).rejects.toBeInstanceOf(AuthenticationError)
        // A currentUser() in flight when the app signs out reads as signed out.
        signedOut = false
        await expect(frappe.auth.currentUser()).resolves.toBeNull()
        expect(refresh).not.toHaveBeenCalled()
        expect(sent).toEqual(['Bearer old', 'Bearer old'])
    })
})

describe('bearerAuth: secrecy', () => {
    it('never exposes the token through the strategy, the client or an error', async () => {
        const { fetch } = stubFetch([json(200, { message: 'Administrator' }), json(401, {})])
        const strategy = bearerAuth({ token: () => SECRET, refresh: () => false })
        const frappe = createClient({ url, fetch, auth: strategy })
        await frappe.request({ path })
        const error = await frappe.request({ path }).catch((reason: unknown) => reason)

        expect(error).toBeInstanceOf(AuthenticationError)
        expect(JSON.parse(JSON.stringify(strategy))).toEqual({})
        expect(Object.isFrozen(strategy)).toBe(true)
        for (const value of [strategy, frappe, error, bearerAuth({ token: SECRET })]) {
            expect(exposed(value)).not.toContain(SECRET)
        }
    })
})
