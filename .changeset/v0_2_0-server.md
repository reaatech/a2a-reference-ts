---
"@reaatech/a2a-reference-server": minor
---

Add health checks (`/healthz`, `/readyz`), an in-memory rate limiter, push-notification delivery wired into the event bus, a Redis SSE coordinator, extended Agent Card serving, and `tasks/sendSubscribe` over JSON-RPC. Add the `trustProxyHeaders` option controlling whether the rate-limit client IP is read from `X-Forwarded-For` (default off). `Retry-After` and the `retryAfter` body field are reported in seconds.
