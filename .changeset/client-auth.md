---
'@frappeforge/client': minor
---

Add authentication: `tokenAuth` for API keys, `sessionAuth` for browser sessions and password
sign-in from Node (with CSRF handling), and `bearerAuth` for OAuth access tokens with an optional
refresh. `frappe.auth` adds `login`, `logout` and `currentUser`.
