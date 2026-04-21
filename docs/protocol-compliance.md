# Protocol Compliance Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| Agent Card discovery | ✅ | `/.well-known/agent.json` |
| JSON-RPC 2.0 methods | ✅ | `tasks/send`, `tasks/get`, `tasks/list`, `tasks/cancel` |
| SSE streaming | ✅ | `tasks/sendSubscribe`, `tasks/subscribe` |
| Task state machine | ✅ | All states + transitions |
| Authentication | ✅ | API key, JWT, JWKS |
| Push notifications | 🚧 | Schema present, not fully wired |
| Extended agent card | 🚧 | Schema present, endpoint stubbed |
| gRPC binding | ❌ | Not planned for v1 |

> **Note:** The `auth-required` task state and the corresponding request/response schemas have been added to `packages/core`.
