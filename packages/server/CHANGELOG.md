# @reaatech/a2a-reference-server

## 0.2.0

### Minor Changes

- [#18](https://github.com/reaatech/a2a-reference-ts/pull/18) [`eb1cf6d`](https://github.com/reaatech/a2a-reference-ts/commit/eb1cf6df4c3aeffa853ee6753ba6b8d02367b6c4) Thanks [@reaatech](https://github.com/reaatech)! - Add health checks (`/healthz`, `/readyz`), an in-memory rate limiter, push-notification delivery wired into the event bus, a Redis SSE coordinator, extended Agent Card serving, and `tasks/sendSubscribe` over JSON-RPC. Add the `trustProxyHeaders` option controlling whether the rate-limit client IP is read from `X-Forwarded-For` (default off). `Retry-After` and the `retryAfter` body field are reported in seconds.

### Patch Changes

- [#16](https://github.com/reaatech/a2a-reference-ts/pull/16) [`336fc6e`](https://github.com/reaatech/a2a-reference-ts/commit/336fc6e142d8b62ab7bc84e76552818c24f0104b) Thanks [@reaatech](https://github.com/reaatech)! - Fix: CI failing on main: All Checks Passed, Code Format, Lint (+2)

  Closes [#15](https://github.com/reaatech/a2a-reference-ts/issues/15)

- Updated dependencies [[`336fc6e`](https://github.com/reaatech/a2a-reference-ts/commit/336fc6e142d8b62ab7bc84e76552818c24f0104b), [`eb1cf6d`](https://github.com/reaatech/a2a-reference-ts/commit/eb1cf6df4c3aeffa853ee6753ba6b8d02367b6c4), [`eb1cf6d`](https://github.com/reaatech/a2a-reference-ts/commit/eb1cf6df4c3aeffa853ee6753ba6b8d02367b6c4), [`eb1cf6d`](https://github.com/reaatech/a2a-reference-ts/commit/eb1cf6df4c3aeffa853ee6753ba6b8d02367b6c4), [`eb1cf6d`](https://github.com/reaatech/a2a-reference-ts/commit/eb1cf6df4c3aeffa853ee6753ba6b8d02367b6c4)]:
  - @reaatech/a2a-reference-observability@0.2.0
  - @reaatech/a2a-reference-auth@0.2.0
  - @reaatech/a2a-reference-core@0.2.0
  - @reaatech/a2a-reference-persistence@0.2.0

## 0.1.1

### Patch Changes

- [#3](https://github.com/reaatech/a2a-reference-ts/pull/3) [`ddb8318`](https://github.com/reaatech/a2a-reference-ts/commit/ddb83183e0e950b9c20a5a560bc7005b9a1d775e) Thanks [@reaatech](https://github.com/reaatech)! - Fix: CI failing on main: All Checks Passed, Security Audit

  Closes [#2](https://github.com/reaatech/a2a-reference-ts/issues/2)

- Updated dependencies [[`0f715bf`](https://github.com/reaatech/a2a-reference-ts/commit/0f715bf607c1334d92b935f5b0404f3744b893e3)]:
  - @reaatech/a2a-reference-observability@0.1.1
