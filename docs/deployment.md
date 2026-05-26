# Deployment Guide

## Docker Compose

```bash
cd docker && docker compose up
```

Services:
- `hello-agent` — Example A2A agent on port 3000
- `redis` — Task store backend
- `postgres` — Optional relational task store backend
- `prometheus` — Metrics scraping
- `grafana` — Metrics dashboards

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `info` | Pino log level |
| `REDIS_URL` | — | Redis connection string |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `JWKS_URI` | — | JWKS endpoint for JWT validation |
| `API_KEYS` | — | Comma-separated API keys |

## Server Options

### Health Checks

Both Express and Hono adapters expose `/healthz` and `/readyz` endpoints:

```ts
const app = createA2AExpressApp({
  agentCard,
  executor,
  healthChecks: [
    {
      name: 'external-api',
      check: async () => {
        const ok = await pingExternalService();
        return { status: ok ? 'ok' : 'degraded' };
      },
    },
  ],
});
```

- `/healthz` — Returns overall health status: `ok` (200), `degraded` (200), or `unhealthy` (503)
- `/readyz` — Returns `ok` (200) or `unhealthy` (503) for readiness probes

### Rate Limiting

```ts
import { RateLimiter } from '@reaatech/a2a-reference-server';

const app = createA2AExpressApp({
  agentCard,
  executor,
  rateLimiter: new RateLimiter({
    windowMs: 60_000,    // 1 minute window
    maxRequests: 100,     // 100 requests per window
  }),
});
```

Rate-limited requests receive a `429 Too Many Requests` response with a `Retry-After` header (seconds) and an `X-RateLimit-Remaining` header.

By default the client IP is taken from the socket peer address. When running behind a trusted load balancer or reverse proxy, set `trustProxyHeaders: true` so the limiter keys off `X-Forwarded-For` instead:

```ts
const app = createA2AExpressApp({
  agentCard,
  executor,
  rateLimiter: new RateLimiter({ windowMs: 60_000, maxRequests: 100 }),
  trustProxyHeaders: true, // only enable behind a proxy that overwrites X-Forwarded-For
});
```

Do not enable this when the server is directly reachable — clients could spoof the header to evade or poison rate limits.

### Push Notifications

Enable push notification webhooks by setting `capabilities.pushNotifications: true` in your Agent Card:

```ts
const agentCard = {
  capabilities: { pushNotifications: true },
  // ...
};
```

Clients can register webhook URLs via `tasks/pushNotification/set` to receive task status and artifact updates as HTTP POST requests.

### Extended Agent Card

Serve additional agent metadata at `/.well-known/agent-card/extended`:

```ts
const app = createA2AExpressApp({
  agentCard,
  executor,
  extendedAgentCard: {
    description: 'Extended capabilities for this agent',
    supportedFeatures: ['batch-processing', 'custom-schemas'],
  },
});
```

Can also be queried via the `tasks/extendedAgentCard` JSON-RPC method.

## Task Stores

The server supports multiple persistence backends:

| Store | Use Case |
|-------|----------|
| `InMemoryTaskStore` | Development and testing |
| `FileSystemTaskStore` | Single-instance production (persists to JSON) |
| `RedisTaskStore` | Multi-instance production with Redis |
| `PostgresTaskStore` | Audit-heavy deployments with SQL |

```ts
import { PostgresTaskStore } from '@reaatech/a2a-reference-persistence';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const taskStore = new PostgresTaskStore({ pool });
await taskStore.initialize();
```

## SSE with Redis Pub/Sub

For horizontal scaling with SSE streaming, use `RedisSseCoordinator` to broadcast events across instances:

```ts
import { RedisSseCoordinator } from '@reaatech/a2a-reference-server';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const coordinator = new RedisSseCoordinator({ redis });
await coordinator.connect();
```

## Kubernetes

> **Coming soon.**
>
> A Helm chart and sample K8s manifests will be added in a future release.

## Edge Deployment

See [edge-deployment.md](./edge-deployment.md) for deployment guides for Cloudflare Workers, Deno Deploy, and Bun.
