# @reaatech/a2a-reference-core

## 0.2.1

### Patch Changes

- [#20](https://github.com/reaatech/a2a-reference-ts/pull/20) [`45a5c40`](https://github.com/reaatech/a2a-reference-ts/commit/45a5c40463cd129ff40141d6595ce39b107db677) Thanks [@reaatech](https://github.com/reaatech)! - Fix: CI failing on main: Code Format, Lint, Release

  Closes [#19](https://github.com/reaatech/a2a-reference-ts/issues/19)

## 0.2.0

### Minor Changes

- [#18](https://github.com/reaatech/a2a-reference-ts/pull/18) [`eb1cf6d`](https://github.com/reaatech/a2a-reference-ts/commit/eb1cf6df4c3aeffa853ee6753ba6b8d02367b6c4) Thanks [@reaatech](https://github.com/reaatech)! - Spec-compliant Agent Card signatures and security schemes.

  - **Breaking:** Agent Card signatures now use the A2A spec JWS shape (`protected`/`signature`/`header`) — a JWS over the RFC 8785 (JCS) canonicalization of the card. Verification runs on `jose` (WebCrypto, edge-compatible) and supports RS/PS/ES 256/384/512 and EdDSA/Ed25519; keys are supplied directly or resolved from the protected header `jku`.
  - **Breaking:** Security schemes now use the spec's OpenAPI-style `type` discriminator (`apiKey` | `http` | `oauth2` | `openIdConnect` | `mutualTLS`) with fully modeled OAuth `flows`, replacing the previous `scheme`/`httpScheme` shape.
  - Add `auth-required` task-state transitions.
