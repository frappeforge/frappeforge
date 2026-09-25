---
'@frappeforge/client': minor
---

Add `createClient()` and `frappe.request()`. Requests get a default 30-second timeout, honor an
`AbortSignal`, and fail with typed errors carrying the server's own messages.
