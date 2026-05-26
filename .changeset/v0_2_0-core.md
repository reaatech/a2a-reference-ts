---
"@reaatech/a2a-reference-core": minor
---

Spec-compliant Agent Card signatures and security schemes.

- **Breaking:** Agent Card signatures now use the A2A spec JWS shape (`protected`/`signature`/`header`) — a JWS over the RFC 8785 (JCS) canonicalization of the card. Verification runs on `jose` (WebCrypto, edge-compatible) and supports RS/PS/ES 256/384/512 and EdDSA/Ed25519; keys are supplied directly or resolved from the protected header `jku`.
- **Breaking:** Security schemes now use the spec's OpenAPI-style `type` discriminator (`apiKey` | `http` | `oauth2` | `openIdConnect` | `mutualTLS`) with fully modeled OAuth `flows`, replacing the previous `scheme`/`httpScheme` shape.
- Add `auth-required` task-state transitions.
