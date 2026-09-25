// Response decoding: JSON bodies, and Frappe's error envelope mapped to typed errors.
//
// `exc` (the server traceback), `_exc_source` and `_debug_messages` are never read: a traceback
// must not reach an error message, a log or a UI.

import {
    AuthenticationError,
    ConflictError,
    FrappeError,
    type FrappeRequestContext,
    NotFoundError,
    PermissionError,
    RateLimitError,
    ServerError,
    type ServerMessage,
    ValidationError,
} from '../errors.js'

/** Error classes for the statuses Frappe uses; `429` and `5xx` are handled in `toError`. */
const errorByStatus: Readonly<Record<number, typeof FrappeError>> = {
    401: AuthenticationError,
    403: PermissionError,
    404: NotFoundError,
    409: ConflictError,
    417: ValidationError,
}

const entities = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'",
    nbsp: ' ',
} as const

/**
 * Reduces an HTML fragment from the server to plain text: inline tags (`<strong>`, `<a>`, …) are
 * removed, every other tag becomes a space (Frappe separates parts of a message with `<br>`,
 * `<details>` / `<summary>`, tables and headings), the common entities are decoded, and whitespace
 * is collapsed.
 */
export function plainText(html: string): string {
    return html
        .replace(/<\/?(?:a|abbr|b|cite|code|em|i|kbd|mark|q|s|small|span|strong|sub|sup|u|var)\b[^>]*>/giu, '')
        .replace(/<[^>]*>/gu, ' ')
        .replace(/&(amp|lt|gt|quot|#39|nbsp);/gu, (_match, name: keyof typeof entities) => entities[name])
        .replace(/\s+/gu, ' ')
        .trim()
}

/**
 * Reads a successful response as JSON. An empty body (including `204`) is `undefined`. A body
 * that is not JSON — typically an SPA dev server or proxy answering `/api/*` with `index.html` —
 * is a `FrappeError` that says so.
 */
export async function readJson(response: Response, context: FrappeRequestContext): Promise<unknown> {
    const text = await response.text()
    if (text === '') return undefined
    const body = parseJson(text)
    if (body !== undefined) return body
    const type = response.headers.get('content-type')
    const received = type === null ? 'an unknown content type' : type.replace(/;.*$/su, '').trim()
    throw new FrappeError(
        `Expected JSON from ${context.method} ${context.url}, received ${received}. Check the site URL and any proxy in between.`,
        { status: response.status, request: context },
    )
}

/** Maps a non-2xx response and its body text to the matching error class. */
export function toError(response: Response, text: string, context: FrappeRequestContext): FrappeError {
    const { status } = response
    const body = parseRecord(text)
    const { messages: serverMessages, raised } = parseServerMessages(body?.['_server_messages'])
    const exceptionText = stringOrUndefined(body?.['exception'])
    const exception =
        stringOrUndefined(body?.['exc_type']) ?? /^(?:[\w.]+\.)?(\w+)(?::|$)/u.exec(exceptionText ?? '')?.[1]
    const errorMessage = stringOrUndefined(body?.['_error_message'])
    const separator = exceptionText?.indexOf(': ') ?? -1

    const candidates = [
        raised === undefined ? undefined : plainText(raised.message),
        errorMessage === undefined ? undefined : plainText(errorMessage),
        exceptionText === undefined || separator < 0 ? undefined : plainText(exceptionText.slice(separator + 2)),
        body === undefined ? htmlTitle(text) : undefined,
    ]
    const message =
        candidates.find((candidate) => candidate !== undefined && candidate !== '') ??
        `Request failed with status ${String(status)} (${context.method} ${new URL(context.url).pathname})`

    const options = {
        status,
        serverMessages,
        request: context,
        ...(exception === undefined ? {} : { exception }),
    }
    if (status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
        return new RateLimitError(message, { ...options, ...(retryAfter === undefined ? {} : { retryAfter }) })
    }
    const ErrorClass = status >= 500 ? ServerError : (errorByStatus[status] ?? FrappeError)
    return new ErrorClass(message, options)
}

/**
 * `_server_messages` is a JSON string of an array of JSON strings, each an object with a
 * `message`. An item that is not JSON is taken as the message itself; an item without a string
 * `message` is skipped.
 *
 * `raised` is the message that describes the failure: the last one Frappe marked
 * `raise_exception` (`frappe.throw` adds its message after any earlier ones), else the first.
 */
function parseServerMessages(value: unknown): {
    messages: readonly ServerMessage[]
    raised: ServerMessage | undefined
} {
    const items = typeof value === 'string' ? parseJson(value) : undefined
    const messages: ServerMessage[] = []
    let raised: ServerMessage | undefined
    for (const item of Array.isArray(items) ? (items as unknown[]) : []) {
        const parsed = typeof item === 'string' ? (parseJson(item) ?? { message: item }) : item
        if (!isRecord(parsed) || typeof parsed['message'] !== 'string') continue
        const { title, indicator } = parsed
        const message: ServerMessage = {
            message: parsed['message'],
            ...(typeof title === 'string' ? { title } : {}),
            ...(typeof indicator === 'string' ? { indicator } : {}),
        }
        messages.push(message)
        if (parsed['raise_exception']) raised = message
    }
    return { messages, raised: raised ?? messages[0] }
}

/**
 * `Retry-After` in milliseconds: delay-seconds, or an HTTP date relative to now, never negative.
 * A date must start with a day name and end in `GMT` (IMF-fixdate, or the obsolete RFC 850 form):
 * `Date.parse` alone also accepts `1.5` or `-5`, and reads an asctime date as local time.
 */
function parseRetryAfter(value: string | null): number | undefined {
    const trimmed = value?.trim() ?? ''
    if (/^\d+$/u.test(trimmed)) return Number(trimmed) * 1000
    const date = /^[a-z]{3,9}, .+ GMT$/iu.test(trimmed) ? Date.parse(trimmed) : Number.NaN
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function htmlTitle(text: string): string | undefined {
    const title = /<title[^>]*>([^<]*)<\/title>/iu.exec(text)?.[1]
    return title === undefined ? undefined : plainText(title)
}

/** `undefined` when the text is not JSON — which JSON itself can never produce. */
function parseJson(text: string): unknown {
    try {
        return JSON.parse(text) as unknown
    } catch {
        return undefined
    }
}

function parseRecord(text: string): Readonly<Record<string, unknown>> | undefined {
    const value = parseJson(text)
    return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrUndefined(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined
}
