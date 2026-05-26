---
"@reaatech/a2a-reference-auth": minor
---

Add `OAuth2Strategy`: token validation plus client-credentials, authorization-code (with PKCE), and refresh grants. Cache the JWKS for the strategy lifetime, accept the `Bearer` scheme case-insensitively (RFC 6749), and add a shared scope-extraction helper.
