---
'@frappeforge/client': minor
---

Add the type vocabulary and the error taxonomy. `FrappeDoc` describes the fields Frappe assigns to
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
