---
'@frappeforge/client': minor
---

Read documents: `frappe.doc.get`, `getSingle`, `list`, `count` and `paginate`. DocType names
autocomplete from generated types, field names and filter values are type-checked, and `list` returns
exactly the fields you ask for. `paginate` walks every matching row in bounded pages that stay stable
while data changes. Long filter lists switch to a POST request automatically.
