---
'@frappeforge/client': minor
---

Add the `retry` option. When enabled, read requests are retried on network errors, 429, 502, 503 and
504 with exponential backoff and jitter, honoring `Retry-After`. Writes are never retried.
