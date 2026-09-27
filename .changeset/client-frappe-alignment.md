---
'@frappeforge/client': minor
---

**Breaking:** names changed, with no aliases for the old ones.

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
