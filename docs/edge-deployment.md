# Edge Runtime Deployment

This guide covers deploying A2A agents on edge runtimes such as Cloudflare Workers, Deno Deploy, and Bun.

## Architecture Overview

The A2A server framework provides a Hono adapter (`createA2AHonoApp`) that is naturally suited for edge deployment, as Hono supports multiple runtimes including Cloudflare Workers, Deno, and Bun.

```
┌─────────────────────────────────────────┐
│            Edge Runtime                  │
│  ┌───────────────────────────────────┐  │
│  │         Hono App (.well-known)     │  │
│  │  Agent Card / Extended Card       │  │
│  │  Health Checks (healthz/readyz)   │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │       JSON-RPC Endpoint (POST /)  │  │
│  │  tasks/send, tasks/get, ...       │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │       SSE Streaming                │  │
│  │  tasks/sendSubscribe, subscribe   │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │      Task Store (KV / D1 / R2)    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

> **Note:** Edge-specific task stores (Cloudflare Workers KV/D1, Deno KV, Bun SQLite) are planned for future releases. Currently, use `InMemoryTaskStore` for edge deployments or a remote `PostgresTaskStore`.

> **Important:** `InMemoryTaskStore` uses in-memory `Map` objects which do **not** persist across Cloudflare Worker requests or Deno Deploy isolates. In stateless edge runtimes, each request may hit a different instance with no shared memory, making `InMemoryTaskStore` effectively volatile and only suitable for **development/testing**. For production edge deployments, use a remote `PostgresTaskStore` (e.g., via `@neondatabase/serverless`) or a custom task store backed by durable storage.

## Limitations

| Feature | Express | Hono | Edge (CF/Deno/Bun) |
|---------|---------|------|-------------------|
| SSE Streaming | ✅ | ✅ | ✅ (ReadableStream) |
| InMemoryTaskStore | ✅ | ✅ | ⚠️ (volatile) |
| FileSystemTaskStore | ✅ | ✅ | ❌ (no FS access) |
| RedisTaskStore | ✅ | ✅ | ⚠️ (via Upstash) |
| PostgresTaskStore | ✅ | ✅ | ⚠️ (via neon/serverless) |
| Rate Limiting | ✅ | ✅ | ✅ |
| Health Checks | ✅ | ✅ | ✅ |
| Auth (API Key/JWT/OAuth2) | ✅ | ✅ | ✅ |
| Push Notifications | ✅ | ✅ | ⚠️ (via webhooks) |

## Recommended Task Stores for Edge

Edge-specific task stores are planned for future releases. For current edge deployments, use `InMemoryTaskStore` (volatile) or a remote `PostgresTaskStore` via a serverless-compatible driver (e.g. `@neondatabase/serverless`).

## Build Configuration

For edge deployments, ensure your build targets the correct runtime:

```jsonc
// tsconfig.json (Cloudflare Workers)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"]
  }
}
```

For Hono-based deployments, ensure you're using the Web-standard `fetch` API rather than Node.js-specific APIs (e.g., avoid `fs`, `net`, `dgram` modules).
