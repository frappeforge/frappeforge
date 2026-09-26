# @frappeforge/client

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
