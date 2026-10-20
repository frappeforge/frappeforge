---
'@frappeforge/codegen': minor
---

`frappeforge-codegen` generates types from a Frappe bench's app source when no site URL is given: run
inside the bench, select with the same `--app`, `--module` and `--doctype`, and no site or credentials
are needed. Each DocType's fields come in the form's order, with the custom fields and property setters
that the bench's apps export in `custom/` folders and `fixtures/` applied, as on a site. `loadFromBench`
does the same from code.
