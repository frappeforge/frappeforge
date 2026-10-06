// When a failed read is tried again, and how long to wait first: the only place that sleeps.

/** Validated retry options. */
export interface ResolvedRetry {
    readonly retries: number
    readonly baseDelay: number
    readonly maxDelay: number
}

/**
 * Transient by nature: no response at all (`0`), too many requests, and the gateway answers of a
 * proxy in front of a busy or restarting server. A `500` is usually a deterministic application
 * error, so it is not retried.
 */
const retriedStatuses: ReadonlySet<number> = new Set([0, 429, 502, 503, 504])

/**
 * The wait in milliseconds before the next try, or `undefined` to give up. `retryCount` is the
 * number of retries already made; `status` is `0` for a request that got no response; `retryAfter`
 * is the response's `Retry-After` in milliseconds, when it sent one. That wait is honored exactly
 * on a `429` or `503`, and one longer than `maxDelay` gives up at once rather than stall.
 * Otherwise the wait is "full jitter": a random number of whole milliseconds below a cap that
 * doubles with each retry, so that many clients do not retry in step.
 */
export function retryDelay(
    retry: ResolvedRetry,
    retryCount: number,
    status: number,
    retryAfter: number | undefined,
): number | undefined {
    if (retryCount >= retry.retries || !retriedStatuses.has(status)) return undefined
    if (retryAfter !== undefined && (status === 429 || status === 503)) {
        return retryAfter <= retry.maxDelay ? retryAfter : undefined
    }
    // From 2^31 on the cap is `maxDelay` (at most 2^31 − 1) or, for a `baseDelay` of 0, 0; a larger
    // power would end in `0 × Infinity`, which is NaN.
    return Math.floor(Math.random() * Math.min(retry.maxDelay, retry.baseDelay * 2 ** Math.min(retryCount, 31)))
}

/**
 * Waits `ms` milliseconds, or less: it returns as soon as `signal` aborts, at once when it already
 * has, so the caller's next abort check rejects without delay. Leaves neither the timer nor a
 * listener behind.
 */
export async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted === true) return
    await new Promise<void>((resolve) => {
        const done = (): void => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', done)
            resolve()
        }
        const timer = setTimeout(done, ms)
        signal?.addEventListener('abort', done, { once: true })
    })
}
