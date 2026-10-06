# @frappeforge/client

## 0.5.0

### Minor Changes

- [#34](https://github.com/frappeforge/frappeforge/pull/34) [`7841d5a`](https://github.com/frappeforge/frappeforge/commit/7841d5a5b65bfe1ec4d46735d32ad5a5d3b1370a) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Add the `retry` option. When enabled, read requests are retried on network errors, 429, 502, 503 and
  504 with exponential backoff and jitter, honoring `Retry-After`. Writes are never retried.

## 0.4.0

### Minor Changes

- [#25](https://github.com/frappeforge/frappeforge/pull/25) [`01991fb`](https://github.com/frappeforge/frappeforge/commit/01991fb1369b1324d7dbd8c193b8ece916660fe2) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Add `frappe.call.get` / `post` for whitelisted methods, `frappe.doc.runMethod` for a document's own
  whitelisted methods, `frappe.file.upload` / `download`, and the `onServerMessages` option for messages Frappe
  sends with successful responses. Uploads are private unless you pass `isPrivate: false`.

## 0.3.0

### Minor Changes

- [#23](https://github.com/frappeforge/frappeforge/pull/23) [`c1c8de0`](https://github.com/frappeforge/frappeforge/commit/c1c8de0318dc7abb2d20fc7ce70886a92ad4f117) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Write documents with Frappe's function names: `frappe.doc.insert`, `insertMany`, `setValue`, `rename`,
  `delete`, `submit` and `cancel`. Inputs are typed from your DocTypes, every call is a single request, and
  failures arrive as `ValidationError`, `ConflictError`, `PermissionError` or `NotFoundError` with the
  server's message.

## 0.2.0

### Minor Changes

- [#17](https://github.com/frappeforge/frappeforge/pull/17) [`bd4c9f4`](https://github.com/frappeforge/frappeforge/commit/bd4c9f4f1941142727a579208e77d19a7df7a006) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - **Breaking:** names changed, with no aliases for the old ones.
  
  - `frappe.doc.list()` is now `frappe.doc.getList()`, and `frappe.auth.currentUser()` is now
    `frappe.auth.getLoggedUser()`: Frappe's own function names. They behave as before.
  - `ConfigurationError` is now `InvalidArgumentError`: it reports an invalid argument to a call as
    often as invalid options. Its `name` is `'InvalidArgumentError'`.
  - `CancelledError` is now `AbortError`, the name `fetch` gives an aborted request. Its `name` is
    `'AbortError'`, and its message reads "Request aborted…" instead of "Request cancelled…".
  - `FrappeError.exception` is now `exceptionType`: it holds the server's exception class name.
    `toJSON()` writes it under that key too, so logs that read `exception` must switch.
  - The `RawRequest` type is now `FrappeRequest`, and `ListFieldOf` is now `ColumnOf`.
  - `FrappeDoc.name` is `string | number`: DocTypes named by "Autoincrement" have integer names. An
    interface that extends `FrappeDoc` without declaring `name` now has `name: string | number`; declare
    `name: string` (or `name: number`) to keep it narrow. Every method that takes a name accepts either.
  
  New reads, named as in Frappe: `getValue`, `getSingleValue`, `exists`, `hasPermission`,
  `validateLink`, `isAmended` and `getPassword`. When nothing is found, the value is `null`.
  `getValue` and `exists` read a child table's rows with `parent`, as `getList` does.

## 0.1.0

### Minor Changes

- [#14](https://github.com/frappeforge/frappeforge/pull/14) [`f6dbf71`](https://github.com/frappeforge/frappeforge/commit/f6dbf715b0827fac74205f220fa70bd3ad579f3a) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Add authentication: `tokenAuth` for API keys, `sessionAuth` for browser sessions and password
  sign-in from Node (with CSRF handling), and `bearerAuth` for OAuth access tokens with an optional
  refresh. `frappe.auth` adds `login`, `logout` and `currentUser`.

- [#16](https://github.com/frappeforge/frappeforge/pull/16) [`442bd86`](https://github.com/frappeforge/frappeforge/commit/442bd867f7526a9a3ace4ac42dee46bb163c9cb6) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Read documents: `frappe.doc.get`, `getSingle`, `list`, `count` and `paginate`. DocType names
  autocomplete from generated types, field names and filter values are type-checked, and `list` returns
  exactly the fields you ask for. `paginate` walks every matching row in bounded pages that stay stable
  while data changes. Long filter lists switch to a POST request automatically.

- [#13](https://github.com/frappeforge/frappeforge/pull/13) [`ebfb1ca`](https://github.com/frappeforge/frappeforge/commit/ebfb1caacf0b6a27745d37ed3a345e94aaa5eaa9) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Add `createClient()` and `frappe.request()`. Requests get a default 30-second timeout, honor an
  `AbortSignal`, and fail with typed errors carrying the server's own messages.

- [#12](https://github.com/frappeforge/frappeforge/pull/12) [`a446b87`](https://github.com/frappeforge/frappeforge/commit/a446b87228c1700299397ccd0e908ebd758df397) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Add the type vocabulary and the error taxonomy. `FrappeDoc` describes the fields Frappe assigns to
  every document. DocType names autocomplete from generated types (`Register`), and DocTypes you have
  not generated accept any field. `Filters`, `ListArgs` and `RequestOptions` describe queries and
  per-call options: filters check values against field types and operators, child-table filters and
  multiple sort fields are supported, and `DocInput` describes create/update input.
  
  Every failure the client raises is a `FrappeError`, so one `catch` handles all of them. The
  subclasses — `ConfigurationError`, `NetworkError`, `TimeoutError`, `CancelledError`,
  `AuthenticationError`, `PermissionError`, `NotFoundError`, `ConflictError` (409), `ValidationError`,
  `RateLimitError` (429, with `retryAfter`) and `ServerError` — let you branch without reading status
  codes. Each carries the server's own messages and the failed request's method and URL, and
  `JSON.stringify(error)` includes the message.

### Patch Changes

- [#11](https://github.com/frappeforge/frappeforge/pull/11) [`6064b96`](https://github.com/frappeforge/frappeforge/commit/6064b963ed7ac83f7ffbce03e6310567a42b3a2c) Thanks [@dhiashalabi](https://github.com/dhiashalabi)! - Packages are now published as ES modules only and require Node.js 22.12 or newer. CommonJS code can
  still `require()` them: Node 22.12+ loads ES modules through `require()` natively.
