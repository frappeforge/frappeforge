---
'@frappeforge/client': patch
'@frappeforge/codegen': patch
---

Packages are now published as ES modules only and require Node.js 22.12 or newer. CommonJS code can
still `require()` them: Node 22.12+ loads ES modules through `require()` natively.
