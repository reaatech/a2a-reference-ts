# @reaatech/a2a-reference-server

A2A server framework with Express 5 and Hono adapters.

## Quick Start

```ts
import { createA2AExpressApp } from '@reaatech/a2a-reference-server';

const app = createA2AExpressApp({
  agentCard: { /* ... */ },
  executor: {
    async execute(context, eventBus) { /* your logic */ },
  },
});

app.listen(3000);
```

## Features

### Dual Adapters
```ts
// Express
const app = createA2AExpressApp({ agentCard, executor });

// Hono (edge-compatible)
const app = createA2AHonoApp({ agentCard, executor });
```

### Health Checks
```ts
const app = createA2AExpressApp({
  agentCard,
  executor,
  healthChecks: [{ name: 'db', check: async () => ({ status: 'ok' }) }],
});
// GET /healthz, GET /readyz
```

### Rate Limiting
```ts
import { RateLimiter } from '@reaatech/a2a-reference-server';

const app = createA2AExpressApp({
  agentCard,
  executor,
  rateLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 100 }),
});
```

### Push Notifications
```ts
import { PushNotificationManager } from '@reaatech/a2a-reference-server';

const app = createA2AExpressApp({
  agentCard: { ...agentCard, capabilities: { pushNotifications: true } },
  executor,
  pushNotificationManager: new PushNotificationManager({ maxRetries: 3 }),
});
```

### Extended Agent Card
```ts
const app = createA2AExpressApp({
  agentCard,
  executor,
  extendedAgentCard: { customData: '...' },
});
// GET /.well-known/agent-card/extended
// RPC: tasks/extendedAgentCard
```

### SSE via Redis Pub/Sub
```ts
import { RedisSseCoordinator } from '@reaatech/a2a-reference-server';
import { Redis } from 'ioredis';

const coordinator = new RedisSseCoordinator({
  redis: new Redis(),
  connectOnInit: true, // auto-connects
});
```

### Auth Integration
```ts
const app = createA2AExpressApp({
  agentCard,
  executor,
  authStrategy: new JwtStrategy({ jwksUri: 'https://auth.example.com/jwks' }),
});
```

## Server Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agentCard` | `AgentCard` | required | Agent discovery metadata |
| `executor` | `AgentExecutor` | required | Your agent logic |
| `taskStore` | `TaskStore` | `InMemoryTaskStore` | Task persistence |
| `authStrategy` | `AuthStrategy` | none | Authentication |
| `rateLimiter` | `RateLimiter` | none | Request rate limiting |
| `extendedAgentCard` | `Record<string, unknown>` | none | Extended metadata |
| `pushNotificationManager` | `PushNotificationManager` | auto | Webhook delivery |
| `healthChecks` | `HealthCheck[]` | none | Custom health probes |
| `version` | `string` | agentCard.version | Version for health endpoint |
| `trustProxyHeaders` | `boolean` | `false` | Derive the rate-limit client IP from `X-Forwarded-For` (only enable behind a trusted proxy) |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/agent.json` | Agent Card |
| GET | `/.well-known/agent-card` | Agent Card |
| GET | `/.well-known/agent-card/extended` | Extended Agent Card |
| GET | `/healthz` | Health check |
| GET | `/readyz` | Readiness check |
| POST | `/` | JSON-RPC 2.0 endpoint |
| POST | `/tasks/sendSubscribe` | SSE streaming |
| GET | `/tasks/:taskId/subscribe` | SSE subscription |
