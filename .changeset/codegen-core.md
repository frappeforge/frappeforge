---
'@frappeforge/codegen': minor
---

Add `generate()` and `normalizeDocType()`: turn DocType metadata into one TypeScript module with an
interface per DocType, named like Frappe's controller class (`Sales Order` → `SalesOrder`), a
`DocTypes` map, and an augmentation of `Register` that types `@frappeforge/client` automatically. The
types follow what Frappe returns: empty fields are optional and `null` in lists, numbers and checks
are always present, and masked fields accept their placeholder. The output is deterministic, so it can
be committed and checked in CI.
