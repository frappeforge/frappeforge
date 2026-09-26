/** One queued answer: a response, a rejection, or a function of the request (for aborts). */
export type Reply = Response | Error | ((request: Request) => Response | Promise<Response>)

/**
 * A fetch stub that records every `Request` and answers from a queue, in order. An empty queue
 * rejects, so an unexpected extra request fails the test. Request bodies are left unread.
 */
export function stubFetch(replies: Reply[] = []): {
    fetch: (request: Request) => Promise<Response>
    requests: Request[]
} {
    const queue = [...replies]
    const requests: Request[] = []
    const fetch = async (request: Request): Promise<Response> => {
        requests.push(request)
        const reply = queue.shift()
        if (reply === undefined) throw new Error(`stubFetch: no reply queued for ${request.method} ${request.url}`)
        if (reply instanceof Error) throw reply
        return reply instanceof Response ? reply : await reply(request)
    }
    return { fetch, requests }
}

/**
 * A JSON response. `headers` may repeat a name, as `[['set-cookie', a], ['set-cookie', b]]`; the
 * content type is `application/json` unless it sets one.
 */
export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
    const all = new Headers(headers)
    if (!all.has('content-type')) all.set('content-type', 'application/json')
    return new Response(JSON.stringify(body), { status, headers: all })
}

/** A text response, HTML by default. */
export function text(status: number, body: string, contentType = 'text/html'): Response {
    return new Response(body, { status, headers: { 'content-type': contentType } })
}

/** Never answers; rejects with the signal's reason once the request's signal aborts. */
export function hang(request: Request): Promise<Response> {
    return new Promise((_resolve, reject) => {
        request.signal.addEventListener(
            'abort',
            () => {
                reject(request.signal.reason as Error)
            },
            { once: true },
        )
    })
}

/** Answers `200` at once, but the body stream errors only when the request's signal aborts. */
export function hangBody(request: Request): Response {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            request.signal.addEventListener(
                'abort',
                () => {
                    controller.error(request.signal.reason)
                },
                { once: true },
            )
        },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

/** The single request a stub recorded; throws when there were none or several. */
export function only(requests: readonly Request[]): Request {
    const [request, ...rest] = requests
    if (request === undefined || rest.length > 0) {
        throw new Error(`Expected exactly one request, got ${String(requests.length)}`)
    }
    return request
}
