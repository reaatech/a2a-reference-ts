# Protocol Compliance Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| Agent Card discovery | ✅ | `/.well-known/agent.json` and `/.well-known/agent-card` |
| Extended Agent Card | ✅ | `GET /.well-known/agent-card/extended` and `tasks/extendedAgentCard` RPC |
| JSON-RPC 2.0 methods | ✅ | `tasks/send`, `tasks/get`, `tasks/list`, `tasks/cancel`, `tasks/sendSubscribe` |
| SSE streaming | ✅ | `tasks/sendSubscribe` (POST), `tasks/subscribe` (GET) |
| Task state machine | ✅ | All 8 states + transitions: submitted, working, input-required, completed, failed, canceled, rejected, auth-required |
| Authentication | ✅ | API key, JWT (RS256), JWKS, OAuth2 (client credentials + authorization code) |
| Mutual TLS | ✅ | `MutualTlsSecurityScheme` defined in Zod schemas |
| Agent Card signatures | ✅ | `AgentCardSignatureSchema` with RSA/ECDSA/Ed25519 verification |
| Push notifications | ✅ | Webhook delivery via `tasks/pushNotification/set`, `get`, `list`, `delete` |
| Push notification config | ✅ | `TaskPushNotificationConfigSchema` with bearer token and apiKey auth |
| Rate limiting | ✅ | Sliding window with configurable max/window |
| Health checks | ✅ | `/healthz` and `/readyz` endpoints (both adapters) |
| Task persistence | ✅ | InMemory, FileSystem, Redis, PostgreSQL |
| Multi-instance SSE | ✅ | Redis pub/sub coordination via `RedisSseCoordinator` |
| gRPC binding | ❌ | Not planned for v1 |
