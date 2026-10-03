---
'@frappeforge/client': minor
---

Write documents with Frappe's function names: `frappe.doc.insert`, `insertMany`, `setValue`, `rename`,
`delete`, `submit` and `cancel`. Inputs are typed from your DocTypes, every call is a single request, and
failures arrive as `ValidationError`, `ConflictError`, `PermissionError` or `NotFoundError` with the
server's message.
