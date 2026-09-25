---
'@frappeforge/client': minor
---

Complete the type vocabulary: DocType names autocomplete from generated types (`Register`), DocTypes
you have not generated accept any field, filters check values against field types and operators,
child-table filters and multiple sort fields are supported, and `DocInput` describes create/update
input. Errors gain `ConflictError` (409) and `RateLimitError` (429, with `retryAfter`), and
`JSON.stringify(error)` now includes the message.

Breaking: `DocTypeMap`, `FilterOperator` and `FilterValue` are removed — constrain DocType maps with
`object`, and use `FilterCondition` for an operator and its value. A DocType that is not in the map is
now an `UnknownDoc` instead of a `FrappeDoc`. List `fields`, filters, `orderBy` and `groupBy` accept
only database columns: no child tables, no `doctype`, and only the standard columns the table has.
