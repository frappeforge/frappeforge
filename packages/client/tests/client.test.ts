import { describe, expect, it, vi } from 'vitest'

import { CancelledError, ConfigurationError, createClient, NotFoundError, TimeoutError } from '../src/index.js'
import { hang, json, only, stubFetch } from './support/fetch.js'

const url = 'https://example.com'

describe('createClient', () => {
    it('validates options before any request', () => {
        expect(() => createClient({ url: 'example.com' })).toThrow(ConfigurationError)
    })

    it('exposes the normalized url and the site name on a frozen client', () => {
        const frappe = createClient({ url: `${url}/`, siteName: 'site1.local' })
        expect(frappe.url).toBe(url)
        expect(frappe.siteName).toBe('site1.local')
        expect(Object.isFrozen(frappe)).toBe(true)
        expect(createClient({ url }).siteName).toBeUndefined()
    })

    it('sends a request and returns the decoded body', async () => {
        const { fetch, requests } = stubFetch([json(200, { message: 'pong' })])
        const frappe = createClient({ url, fetch })
        await expect(frappe.request({ path: '/api/method/frappe.ping' })).resolves.toEqual({ message: 'pong' })
        expect(only(requests).url).toBe(`${url}/api/method/frappe.ping`)
    })

    it('works when request is destructured', async () => {
        const { fetch } = stubFetch([json(200, { data: [] })])
        const { request } = createClient({ url, fetch })
        await expect(request({ path: '/api/resource/ToDo' })).resolves.toEqual({ data: [] })
    })

    it('passes per-request options through', async () => {
        vi.useFakeTimers()
        try {
            const controller = new AbortController()
            controller.abort()
            const { fetch, requests } = stubFetch([hang])
            const frappe = createClient({ url, fetch })
            await expect(frappe.request({ path: '/api/x' }, { signal: controller.signal })).rejects.toBeInstanceOf(
                CancelledError,
            )
            const timedOut = frappe.request({ path: '/api/x' }, { timeout: 50 }).catch((error: unknown) => error)
            await vi.advanceTimersByTimeAsync(50)
            expect(await timedOut).toBeInstanceOf(TimeoutError)
            expect(requests).toHaveLength(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it('rejects with typed errors', async () => {
        const { fetch } = stubFetch([json(404, { exc_type: 'DoesNotExistError' })])
        const frappe = createClient({ url, fetch })
        await expect(frappe.request({ path: '/api/resource/ToDo/nope' })).rejects.toBeInstanceOf(NotFoundError)
    })
})
