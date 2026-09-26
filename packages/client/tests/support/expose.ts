import { inspect } from 'node:util'

/**
 * Everything a log line, a debugger or a crash report can show of `value`: its JSON, and
 * `util.inspect` with hidden properties, getters and unlimited depth.
 */
export function exposed(value: unknown): string {
    const json = JSON.stringify(value) as string | undefined
    return `${json ?? ''}\n${inspect(value, { depth: Infinity, showHidden: true, getters: true })}`
}

/** A promise with its `resolve` and `reject` (the ES2022 lib has no `Promise.withResolvers`). */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}
