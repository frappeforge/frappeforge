---
'@frappeforge/client': minor
---

Add `frappe.call.get` / `post` for whitelisted methods, `frappe.doc.runMethod` for a document's own
whitelisted methods, `frappe.file.upload` / `download`, and the `onServerMessages` option for messages Frappe
sends with successful responses. Uploads are private unless you pass `isPrivate: false`.
