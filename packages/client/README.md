# @frappeforge/client

Zero-dependency, `fetch`-native TypeScript client for the Frappe Framework REST API. It runs anywhere
`fetch` runs: Node.js, browsers, workers and edge runtimes.

> **Status: pre-release.** The API may change before `1.0.0`. Supported Frappe versions: v15 and v16.

- **Typed documents.** DocType names autocomplete, field names, filter values and the fields you write
  are type-checked, and a list returns exactly the fields you ask for.
- **Typed errors.** Every failure is a `FrappeError` subclass that carries the server's own messages,
  and never its traceback.
- **Authentication built in.** API keys, browser and Node sessions, and OAuth bearer tokens with
  refresh — and no credential is ever visible when you log the client.
- **Timeouts and aborts built in.** A 30-second default, per-request overrides, and `AbortSignal`.
- **No dependencies, no globals patched.** Bring your own `fetch` for tests or instrumentation.

## Install

```sh
pnpm add @frappeforge/client
```

## Quick start

Use an API key and secret from **User → Settings → API Access**. Keep them on the server: never ship
them to a browser.

```ts
import { createClient, tokenAuth } from '@frappeforge/client'

const frappe = createClient({
    url: 'https://example.com',
    auth: tokenAuth({ apiKey: process.env.FRAPPE_API_KEY!, apiSecret: process.env.FRAPPE_API_SECRET! }),
})

const open = await frappe.doc.getList('ToDo', {
    fields: ['name', 'description', 'priority'],
    filters: { status: 'Open' },
    orderBy: { field: 'modified', order: 'desc' },
    limit: 10,
})
```

Without `auth`, requests run as Guest, which can call only public methods such as `frappe.ping`.

## Options

`createClient()` checks its options at once and throws an `InvalidArgumentError` before any request is
sent.

| Option     | Default        | Description                                                                                                                                                                            |
| ---------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`      | —              | Site URL. A path prefix is allowed (`https://example.com/frappe`); credentials, a query or a fragment are not.                                                                         |
| `headers`  | `{}`           | Headers sent with every request.                                                                                                                                                       |
| `timeout`  | `30000`        | Time budget per attempt in milliseconds, including reading the response; a replay after a `401` gets its own, and a strategy's `token()` or `refresh()` is not timed. `0` disables it. |
| `siteName` | —              | Sends `X-Frappe-Site-Name`, for a site reached through a host name that differs from the site name (visible ASCII, e.g. `site1.local`). In browsers it triggers a CORS preflight.      |
| `fetch`    | global `fetch` | A fetch-compatible function, for tests or instrumentation. It must honor `request.signal`.                                                                                             |
| `auth`     | —              | How requests authenticate: `tokenAuth`, `sessionAuth`, `bearerAuth` or your own `AuthStrategy` ([Authentication](#authentication)). Without it, requests run as Guest.                 |

## Documents

`frappe.doc` reads and writes documents. Its methods take Frappe's own function names ([Coming from
Frappe](#coming-from-frappe)), and every one takes a `RequestOptions` object last, like `request()`.

```ts
const todo = await frappe.doc.get('ToDo', 'TODO-0001') // one document, with its child tables
const settings = await frappe.doc.getSingle('System Settings') // a single DocType's record
const count = await frappe.doc.count('ToDo', { status: 'Open' })

const rows = await frappe.doc.getList('ToDo', {
    fields: ['name', 'description'], // default: `name` only; `['*']` for every column
    filters: { status: 'Open', priority: ['in', ['High', 'Medium']] },
    orFilters: [
        ['allocated_to', '=', 'user@example.com'],
        ['owner', '=', 'user@example.com'],
    ],
    orderBy: [{ field: 'priority', order: 'desc' }, { field: 'modified' }], // `asc` by default
    limit: 50, // default 20
    offset: 0,
})

for await (const row of frappe.doc.paginate('ToDo', { fields: ['description'], pageSize: 100 })) {
    console.log(row.name, row.description) // every matching ToDo, 100 per request
}
```

- **Filters** come in two forms. An object: a value means equality, and `[operator, value]` means an
  operator, so `{ status: ['Open', 'Closed'] }` is an error — write `{ status: ['in', ['Open', 'Closed']] }`.
  Or an array of `[field, operator, value]`, which also accepts `[childDocType, field, operator, value]`
  for a child table. `null` matches empty fields, and booleans are sent as `1` / `0`.
- **Operators:** `=`, `!=`, `>`, `<`, `>=`, `<=`, `like`, `not like`, `in`, `not in`, `is` (`'set'` /
  `'not set'`), `between`, `timespan` (such as `'this week'`), `descendants of`, `not descendants of`,
  `ancestors of` and `not ancestors of`.
- **Documents and rows differ.** `get` leaves empty fields out of the document, as Frappe does; a list
  row has every column it asked for, with `null` for an empty one. Fields the user may not read are
  left out of both.
- **`paginate`** continues each page after the last `name` of the page before, so a row that matches
  for the whole walk is visited exactly once, however many rows are created, changed or deleted
  meanwhile. A row created during the walk is visited only if its `name` sorts after the rows already
  read. It always includes `name`, sorts by it, and takes no `orderBy`, `groupBy`, `limit` or
  `offset`. Aborting its signal ends the walk with `AbortError`.
- **Long queries:** a `getList` or `count` whose path and query string would be longer than 3800
  characters (the site URL is not counted), such as a long `in` filter, is sent as a POST to
  `frappe.client.get_list` or `frappe.client.get_count` instead, with the same result.
- **Child tables** are listed with `parent`, the parent DocType:
  `frappe.doc.getList('Has Role', { fields: ['role'], parent: 'User' })`. Only that DocType's rows come
  back, though other DocTypes may use the same child table. Frappe rejects `parent` for any other
  DocType, so generated types accept it only on child tables.
- **Names** are strings, or integers for DocTypes named by "Autoincrement". Every method accepts a
  name either way, as a Link field holds it as a string: `frappe.doc.get('Counter', 5)` and
  `frappe.doc.get('Counter', '5')` read the same document. Names are encoded for the URL, so `/`, `#`,
  `?` and spaces are safe.

### Single values and permissions

```ts
const status = await frappe.doc.getValue('ToDo', 'TODO-0001', 'status') // the value, or null
const row = await frappe.doc.getValue('ToDo', { status: 'Open' }, ['name', 'allocated_to']) // a row, or null
const country = await frappe.doc.getSingleValue('System Settings', 'country')

await frappe.doc.exists('User', 'user@example.com') // true or false
await frappe.doc.hasPermission('ToDo', 'TODO-0001', 'write') // default 'read'
await frappe.doc.validateLink('User', 'user@example.com', ['full_name']) // { name, full_name } | null
await frappe.doc.isAmended('Sales Invoice', 'SINV-0001') // true once the cancelled invoice is amended
await frappe.doc.getPassword('Email Account', 'Support', 'password') // System Manager only
```

- **"Nothing" is `null`**: no matching document, or an empty field. To tell the two apart, ask for
  `['field']`: a missing document is still `null`, an empty field is `{ field: null }`.
- **By name or by filters.** `getValue` and `exists` take either. With filters that match several
  documents, `getValue` reads the first in the DocType's default sort order; for another one, use
  `getList({ filters, orderBy, limit: 1 })`. Empty filters are rejected, as they would match any
  document.
- **Child tables:** pass the parent DocType, as for `getList`:
  `frappe.doc.exists('Has Role', { parent: 'user@example.com', role: 'System Manager' }, { parent: 'User' })`.
  Without it, Frappe rejects the read.
- **Single DocTypes:** use `getSingleValue`, which returns values cast to their field type. Frappe
  casts a value never set too — `''` for text and select fields, `0` for numbers, `'0001-01-01'` for
  dates — so only types such as Attach come back `null`. `getValue` and `exists` are no use on a
  single: Frappe ignores the name and filters (so `exists` is always `true`), and Frappe 15 answers
  every value as a string.
- **Permissions:** `getValue`, `exists` and `validateLink` need read permission on the DocType, and
  answer a `PermissionError` without it — never a misleading `null` or `false`. `hasPermission` takes
  one of Frappe's permission types (`'read'`, `'write'`, `'submit'`, …); for Administrator it is
  always `true`, and for anyone else a document that does not exist is a `NotFoundError`.
- **`validateLink`** returns the name as stored. On MariaDB, names compare without regard to case, so
  `'USER@example.com'` finds `'user@example.com'`; on PostgreSQL the case must match. Unlike Desk, it
  does not apply a Link field's filters or custom query.
- **`isAmended`** is sent as a POST, so a browser never answers it from its cache.
- **`getPassword`** reads a Password field for a System Manager. A field with no stored password is a
  `ValidationError` from Frappe. Keep the value out of logs and caches.

### Writing documents

```ts
const todo = await frappe.doc.insert('ToDo', { description: 'Ship 1.0', priority: 'High' })
await frappe.doc.setValue('ToDo', todo.name, { status: 'Closed' }) // returns the saved document
const names = await frappe.doc.insertMany('ToDo', [{ description: 'One' }, { description: 'Two' }])
const renamed = await frappe.doc.rename('ToDo', todo.name, 'TODO-SHIP') // the stored new name
await frappe.doc.delete('ToDo', renamed)

await frappe.doc.submit('Sales Invoice', 'SINV-0001') // docstatus 1
await frappe.doc.cancel('Sales Invoice', 'SINV-0001') // docstatus 2
```

Each method is one request, and Frappe runs the DocType's permissions, validation and hooks, as a
save in Desk does.

- **Every field is optional** in the types, because `validate` hooks often fill mandatory fields. A
  field that is still missing is a `ValidationError` naming it. The types of a generated DocType
  leave out the fields the server sets (`owner`, `modified`, `docstatus`, `idx`, …). They are not
  checked at runtime, so a document read with `get` can be sent back, and its `docstatus` reaches
  Frappe as it is: change `docstatus` with `submit` and `cancel`.
- **Child tables in `setValue` replace the table.** Rows without a `name` are added. Rows with a `name`
  are kept, but **rebuilt from what you send**: a field you leave out of a kept row is cleared, or is a
  `ValidationError` if it is mandatory. Rows you leave out are deleted. A row whose `name` does not
  exist is not saved, though the document `setValue` returns still lists it. To change one row, send
  the whole table, with each row you keep in full, as `get` returned it:

    ```ts
    const order = await frappe.doc.get('Sales Order', 'SO-0001')
    const items = order.items.map((item) => (item.item_code === 'X' ? { ...item, qty: 2 } : item))
    await frappe.doc.setValue('Sales Order', 'SO-0001', { items })
    ```

- **Sending a document back.** A document read with `get` can be passed to `setValue` whole. Its
  `modified` makes Frappe refuse the save with a `ValidationError` (`exceptionType`
  `TimestampMismatchError`) when someone saved the document in between, as Desk does.
- **Names.** `insert` keeps a `name` only for DocTypes named by the user ("Prompt"); other naming
  rules replace it. `setValue` never changes a name — a different `name` in its values is an
  `InvalidArgumentError` — use `rename`, which also updates every Link to the document. The DocType
  must allow renaming.
- **`insertMany`** saves up to 200 documents in one transaction: when one fails, none is saved. It
  returns their names, in order.
- **Submit and cancel** set `docstatus`, exactly as Frappe's `submit()` and `cancel()` do. Submitting a
  document that is already submitted is not an error: Frappe saves it again. Cancelling a draft, or
  changing a cancelled document, is a `ValidationError`.
- **Amending** a cancelled document is an insert with `amended_from`; Frappe names it `<name>-1`:
  `frappe.doc.insert('Sales Invoice', { ...fieldsToCopy, amended_from: 'SINV-0001' })`.
- **Deleting** a submitted document, or one that other records link to, is a `ValidationError`. Delete
  a child row through its parent, by leaving it out of the table in `setValue`: deleting the row by its
  own name skips the parent's save and hooks.

### Typed DocTypes

Declare your DocTypes once, and every call is checked against them:

```ts
import type { FrappeDoc } from '@frappeforge/client'

interface ToDo extends FrappeDoc {
    doctype: 'ToDo'
    name: string
    status?: 'Open' | 'Closed' | 'Cancelled' | null
    priority?: 'High' | 'Medium' | 'Low' | null
    description: string
}

declare module '@frappeforge/client' {
    interface Register {
        docTypes: { ToDo: ToDo }
    }
}

const rows = await frappe.doc.getList('ToDo', { fields: ['description', 'status'] })
// { description: string; status?: 'Open' | 'Closed' | 'Cancelled' | null }[]

await frappe.doc.getList('ToDo', { filters: { status: 'Opne' } }) // compile error: not a status
```

To type one client only, pass the map instead: `createClient<{ ToDo: ToDo }>({ url })`. A DocType that
is not in the map is still accepted, with `unknown` field values.

## Coming from Frappe

Methods take the name of the Frappe function they call, camelCased, without the word the namespace
already says. Document methods take the DocType first.

| FrappeForge                                  | Frappe function                                        |
| -------------------------------------------- | ------------------------------------------------------ |
| `frappe.doc.get(doctype, name)`              | `get_doc`                                              |
| `frappe.doc.getSingle(doctype)`              | `get_single`                                           |
| `frappe.doc.getList(doctype, args)`          | `get_list`                                             |
| `frappe.doc.count(doctype, filters)`         | `count`                                                |
| `frappe.doc.paginate(doctype, args)`         | none — every matching row, one page per request        |
| `frappe.doc.getValue(doctype, name, field)`  | `get_value`                                            |
| `frappe.doc.getSingleValue(doctype, field)`  | `get_single_value`                                     |
| `frappe.doc.exists(doctype, name)`           | `exists`                                               |
| `frappe.doc.hasPermission(doctype, name)`    | `has_permission`                                       |
| `frappe.doc.validateLink(doctype, name)`     | `validate_link` (Frappe 15; built on `get_value` here) |
| `frappe.doc.isAmended(doctype, name)`        | `is_document_amended`                                  |
| `frappe.doc.getPassword(doctype, name, f)`   | `get_password`                                         |
| `frappe.doc.insert(doctype, data)`           | `insert` (Desk passes `{ doctype, … }`)                |
| `frappe.doc.insertMany(doctype, docs)`       | `insert_many`                                          |
| `frappe.doc.setValue(doctype, name, values)` | `set_value`; also replaces `frappe.client.save`        |
| `frappe.doc.rename(doctype, name, newName)`  | `rename_doc`                                           |
| `frappe.doc.delete(doctype, name)`           | `delete_doc`                                           |
| `frappe.doc.submit(doctype, name)`           | `submit`                                               |
| `frappe.doc.cancel(doctype, name)`           | `cancel`                                               |
| `frappe.auth.login()` / `logout()`           | `login`, `logout`                                      |
| `frappe.auth.getLoggedUser()`                | `get_logged_user` (`null` here for Guest)              |

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

| Error                  | When                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ValidationError`      | `417`: the server rejected the data, e.g. a missing mandatory field.                                                                                  |
| `PermissionError`      | `403`: not allowed, or not signed in (Frappe answers a guest with 403).                                                                               |
| `NotFoundError`        | `404`: no such document, method or route.                                                                                                             |
| `ConflictError`        | `409`: a document with this name already exists.                                                                                                      |
| `AuthenticationError`  | `401`: invalid credentials; also a `login()` that did not complete.                                                                                   |
| `RateLimitError`       | `429`: too many requests; `retryAfter` holds the wait in milliseconds, when sent.                                                                     |
| `ServerError`          | `5xx`: the server, or a proxy in front of it, failed.                                                                                                 |
| `TimeoutError`         | The request exceeded its timeout.                                                                                                                     |
| `AbortError`           | Your `AbortSignal` aborted the request.                                                                                                               |
| `NetworkError`         | No response arrived: DNS, a refused connection, or a browser CORS rejection.                                                                          |
| `InvalidArgumentError` | An invalid argument: to a call, to the client or a strategy, or a request that cannot be built (e.g. a `GET` with a body). Thrown before any request. |
| `FrappeError`          | Any other status, such as `400`.                                                                                                                      |

```ts
import { ConflictError, FrappeError, ValidationError } from '@frappeforge/client'

try {
    await frappe.request({ method: 'POST', path: '/api/resource/ToDo', body: {} })
} catch (error) {
    if (error instanceof ValidationError) {
        console.log(error.message) // "Error: Value missing for ToDo: Description"
        console.log(error.exceptionType) // "MandatoryError"
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
- `exceptionType` is the server's exception class, e.g. `DoesNotExistError`.
- `request` holds the method and the URL's origin and path only. The query string, which can carry
  filters and arguments, is never included.
- `JSON.stringify(error)` gives a loggable object. The server's traceback is never read into an error.

## Authentication

| Strategy                           | For                                          | Sends                                                                      |
| ---------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `tokenAuth({ apiKey, apiSecret })` | Servers, scripts and sync jobs               | `Authorization: token <key>:<secret>`                                      |
| `sessionAuth()`                    | Browser apps, and password sign-in from Node | The session cookie, and the CSRF token on `POST`, `PUT`, `PATCH`, `DELETE` |
| `bearerAuth({ token, refresh })`   | OAuth access tokens                          | `Authorization: Bearer <token>`                                            |

Credentials are held in closures: `JSON.stringify` and `console.log` of a strategy, a client or an
error the client throws never show them. A strategy's options are checked when it is created, and a
mistake is an `InvalidArgumentError` that never quotes the value; so is an invalid header, anywhere.

### Sessions

```ts
import { createClient, sessionAuth } from '@frappeforge/client'

const frappe = createClient({ url: 'https://example.com', auth: sessionAuth() })

const { fullName, homePage } = await frappe.auth.login({ username: 'user@example.com', password })
const user = await frappe.auth.getLoggedUser() // 'user@example.com', or null for Guest
await frappe.auth.logout()
```

The same code works in both places:

- **In a browser**, the browser keeps the session cookie; requests are sent with
  `credentials: 'include'`. The CSRF token comes from the `csrf_token` global that Frappe sets on the
  pages it renders, or from the `csrfToken` option (a string, or a function returning one). An
  unrendered `{{ csrf_token }}` placeholder, as in a dev server's `index.html`, is ignored. For a
  different origin, the site must allow it in `allow_cors`. In a page served by Frappe, reload after
  `login()` so that the page's token belongs to the new session, as Frappe's own login page does.
- **In Node**, which keeps no cookies, the strategy keeps the cookies it receives and sends them
  back. A session created through the API needs no CSRF token.

`login()` rejects with `AuthenticationError` for wrong credentials, and also when Frappe asks for a
second factor or for a new password, since no session exists then. `logout()` forgets the stored
cookies even if the request fails.

An expired session is not a `401`: Frappe runs the request as Guest, and protected endpoints answer
`403`. After a `PermissionError`, `getLoggedUser()` tells "signed out" (`null`) from "not allowed".

### Bearer tokens and refresh

```ts
import { bearerAuth, createClient } from '@frappeforge/client'

const frappe = createClient({
    url: 'https://example.com',
    auth: bearerAuth({
        token: () => tokens.access, // read before every request
        refresh: async () => {
            tokens = await renewTokens(tokens.refresh)
            return true // send the failed request again
        },
    }),
})
```

After a `401`, `refresh` is called and the request is sent once more with the new token. Requests
that fail together share one `refresh` call. When `token()` no longer returns a usable token (the
user signed out meanwhile), the `401` surfaces as it is. The timeout covers each attempt, not
`token()` or `refresh()`; the request's `signal` cancels those too.

### Your own strategy

Implement `AuthStrategy`: `apply(headers, method)` adds credentials before every attempt, and the
optional `credentials`, `onResponse`, `onUnauthorized` and `clear` cover cookies, refresh and
sign-out. What a hook throws reaches the caller unchanged, so keep credentials out of your own error
messages.

```ts
import { type AuthStrategy, createClient } from '@frappeforge/client'

const vaultAuth: AuthStrategy = {
    async apply(headers) {
        const { key, secret } = await vault.read('frappe')
        headers.set('Authorization', `token ${key}:${secret}`)
    },
}
const frappe = createClient({ url: 'https://example.com', auth: vaultAuth })
```

## Timeouts and aborts

```ts
// A shorter time budget for one request (overrides the client's `timeout`)
await frappe.request({ path: '/api/method/frappe.ping' }, { timeout: 5_000 })

// Abort from your code, e.g. when a component unmounts
const controller = new AbortController()
const pending = frappe.request({ path: '/api/resource/ToDo' }, { signal: controller.signal })
controller.abort()
await pending // rejects with AbortError; the abort reason is its `cause`
```

A timeout rejects with `TimeoutError` and an abort with `AbortError`, as `fetch` names them, so a user navigating
away is never reported as a failure. The timeout covers each attempt; the signal covers the whole
call, including a strategy that is still fetching a token. `options.headers` adds or overrides headers for one request.

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
