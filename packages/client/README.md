# @frappeforge/client

Zero-dependency, `fetch`-native TypeScript client for the Frappe Framework REST API. It runs anywhere
`fetch` runs: Node.js, browsers, workers and edge runtimes.

> **Status: pre-release.** The API may change before `1.0.0`. Supported Frappe versions: v15 and v16.

- **Typed errors.** Every failure is a `FrappeError` subclass that carries the server's own messages,
  and never its traceback.
- **Timeouts and cancellation built in.** A 30-second default, per-request overrides, and `AbortSignal`.
- **No dependencies, no globals patched.** Bring your own `fetch` for tests or instrumentation.

## Install

```sh
pnpm add @frappeforge/client
```

## Quick start

```ts
import { createClient } from '@frappeforge/client'

const frappe = createClient({ url: 'https://example.com' })

const { message } = await frappe.request<{ message: string }>({ path: '/api/method/frappe.ping' })
console.log(message) // "pong"
```

To call as a user, send an API key and secret from **User → Settings → API Access**. Keep them on
the server: never ship them to a browser.

```ts
const frappe = createClient({
    url: 'https://example.com',
    headers: { Authorization: `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}` },
})

const { data } = await frappe.request<{ data: { name: string; description: string } }>({
    path: '/api/resource/ToDo/TODO-0001',
})
```

## Options

`createClient()` checks its options at once and throws a `ConfigurationError` before any request is
sent.

| Option     | Default        | Description                                                                                                                                                                       |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`      | —              | Site URL. A path prefix is allowed (`https://example.com/frappe`); credentials, a query or a fragment are not.                                                                    |
| `headers`  | `{}`           | Headers sent with every request.                                                                                                                                                  |
| `timeout`  | `30000`        | Time budget per request in milliseconds, including reading the response. `0` disables it.                                                                                         |
| `siteName` | —              | Sends `X-Frappe-Site-Name`, for a site reached through a host name that differs from the site name (visible ASCII, e.g. `site1.local`). In browsers it triggers a CORS preflight. |
| `fetch`    | global `fetch` | A fetch-compatible function, for tests or instrumentation. It must honor `request.signal`.                                                                                        |

## Requests

`frappe.request(init, options?)` sends any request to the site and resolves with the JSON body exactly
as Frappe returned it: `{ message }` from `/api/method/…`, `{ data }` from `/api/resource/…`. An empty
body resolves to `undefined`.

```ts
await frappe.request({
    method: 'POST', // GET (default), POST, PUT or DELETE
    path: '/api/resource/ToDo', // starts with "/"; parameters go in `query`
    body: { description: 'Ship the release' }, // sent as JSON; FormData is sent as multipart
})

await frappe.request({
    path: '/api/resource/ToDo',
    query: { fields: ['name', 'status'], limit_page_length: 20 },
})
```

- **Query values:** strings are sent as they are, numbers as text, booleans as `1` / `0`, arrays and
  objects as JSON. `null` and `undefined` are left out. Pass dates as strings, such as `'2026-01-31'`.
- **Path segments:** encode dynamic parts yourself, e.g.
  `` `/api/resource/ToDo/${encodeURIComponent(name)}` ``, so names containing `/`, `#` or `?` work.
  A path with whitespace, `\`, or a `.` or `..` segment is rejected: the URL would not reach the
  path you wrote.
- **Body:** plain values are sent as JSON and `FormData` as multipart. Any other body (`Blob`,
  `URLSearchParams`, binary data, a stream) is rejected, as is a query value JSON cannot encode.
- **Types:** the type argument (`request<T>()`) describes the body you expect. It is not checked at
  runtime.

## Errors

Every failure is a `FrappeError`, so one `catch` handles them all. Branch on the subclass instead of
reading status codes:

| Error                 | When                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| `ValidationError`     | `417`: the server rejected the data, e.g. a missing mandatory field.              |
| `PermissionError`     | `403`: not allowed, or not signed in (Frappe answers a guest with 403).           |
| `NotFoundError`       | `404`: no such document, method or route.                                         |
| `ConflictError`       | `409`: a document with this name already exists.                                  |
| `AuthenticationError` | `401`: invalid credentials.                                                       |
| `RateLimitError`      | `429`: too many requests; `retryAfter` holds the wait in milliseconds, when sent. |
| `ServerError`         | `5xx`: the server, or a proxy in front of it, failed.                             |
| `TimeoutError`        | The request exceeded its timeout.                                                 |
| `CancelledError`      | Your `AbortSignal` fired.                                                         |
| `NetworkError`        | No response arrived: DNS, a refused connection, or a browser CORS rejection.      |
| `ConfigurationError`  | Invalid options, or a request that cannot be built (e.g. a `GET` with a body).    |
| `FrappeError`         | Any other status, such as `400`.                                                  |

```ts
import { ConflictError, FrappeError, ValidationError } from '@frappeforge/client'

try {
    await frappe.request({ method: 'POST', path: '/api/resource/ToDo', body: {} })
} catch (error) {
    if (error instanceof ValidationError) {
        console.log(error.message) // "Error: Value missing for ToDo: Description"
        console.log(error.exception) // "MandatoryError"
        console.log(error.serverMessages) // [{ message: 'Error: Value missing for ToDo: Description', title: 'Message' }]
    } else if (error instanceof ConflictError) {
        // …
    } else {
        throw error
    }
}
```

- `message` is plain text, taken from the message the server raised. `serverMessages` keep the
  original HTML for interfaces that render it.
- `exception` is the server's exception class, e.g. `DoesNotExistError`.
- `request` holds the method and the URL's origin and path only. The query string, which can carry
  filters and arguments, is never included.
- `JSON.stringify(error)` gives a loggable object. The server's traceback is never read into an error.

## Timeouts and cancellation

```ts
// A shorter time budget for one request (overrides the client's `timeout`)
await frappe.request({ path: '/api/method/frappe.ping' }, { timeout: 5_000 })

// Cancel from your code, e.g. when a component unmounts
const controller = new AbortController()
const pending = frappe.request({ path: '/api/resource/ToDo' }, { signal: controller.signal })
controller.abort()
await pending // rejects with CancelledError; the abort reason is its `cause`
```

A timeout rejects with `TimeoutError` and a cancellation with `CancelledError`, so a user navigating
away is never reported as a failure. `options.headers` adds or overrides headers for one request.

## Testing and instrumentation

Pass your own `fetch`. It receives a standard `Request` and returns a `Response`:

```ts
const frappe = createClient({
    url: 'https://example.com',
    fetch: async (request) => {
        const started = performance.now()
        const response = await fetch(request)
        console.log(request.method, new URL(request.url).pathname, response.status, performance.now() - started)
        return response
    },
})
```

## Requirements

- Node.js 22.12 or newer, or any runtime with `fetch`, `AbortController` and `URL.canParse`.
- Published as an ES module only. CommonJS code can still `require('@frappeforge/client')` on Node.js
  22.12+ (22.12 itself prints a one-time experimental warning; 22.13+ does not).
- TypeScript: `module: "nodenext"` or `moduleResolution: "bundler"`.

## License

[MIT](./LICENSE). FrappeForge is an independent community project, not affiliated with
Frappe Technologies.
