---
'@frappeforge/codegen': minor
---

Add the `frappeforge-codegen` CLI. It reads DocTypes from a running site — including custom fields and
property setters — selected by name, module or app, and writes one typed module. Settings come from
flags, the environment and a committed `frappeforge.json`, which `schema.json` describes for editors.
`--check` fails CI when the committed module is out of date. Credentials are read only from
`FRAPPE_API_KEY` and `FRAPPE_API_SECRET`, and a config file holding one is refused. A DocType reached
through a module or app whose metadata the site cannot load is left out with a warning. `loadFromSite()`
does the same reading from code, with any `@frappeforge/client` client.

`generate()` now gives a field named like a standard field (such as `parent` on `Custom DocPerm`) the
standard field's type, so the generated interface always extends `FrappeDoc`.
