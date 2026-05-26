# a2a-reference-ts

[![CI](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.22-orange)](https://pnpm.io/)
[![Vitest](https://img.shields.io/badge/test-vitest-green)](https://vitest.dev/)

> **Production-ready TypeScript reference implementation of the [Agent-to-Agent (A2A) protocol](https://github.com/google/A2A)** — server framework, client SDK, CLI scaffolding, and a bidirectional A2A ↔ MCP bridge.

---

## Why a2a-reference-ts?

The A2A protocol defines how AI agents discover each other, exchange messages, and manage task lifecycles. This project provides the canonical TypeScript implementation — battle-tested Zod schemas, pluggable server adapters, a type-safe client, and infrastructure for authentication, persistence, observability, and push notifications.

It also includes a **bidirectional A2A ↔ MCP bridge**, allowing A2A agents to call MCP tools and MCP hosts to delegate work to A2A agents. If you're building interoperable agent systems, this is your starting point.

---

## Quick Start

### Using the CLI

```bash
npx @reaatech/a2a-reference-cli init my-agent --hono
cd my-agent
npm install
npm run dev
```

Your agent is live at `http://localhost:3001` with a fully configured A2A server.

### Hello Agent (Manual)

```typescript
import { createA2AExpressApp } from "@reaatech/a2a-reference-server";
import type { AgentExecutor } from "@reaatech/a2a-reference-server";

const app = createA2AExpressApp({
  agentCard: {
    name: "Hello Agent",
    description: "A friendly agent",
    url: "http://localhost:3000",
    version: "1.0.0",
    protocolVersion: "0.3.0",
    capabilities: { streaming: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [{ id: "echo", name: "Echo", description: "Echo a message", tags: ["utility"], examples: ["Hello!"] }],
    supportedInterfaces: [{ url: "http://localhost:3000", protocolBinding: "a2a", protocolVersion: "0.3.0" }],
  },
  executor: {
    async execute(context, eventBus) {
      const text = context.message.parts.filter((p) => p.kind === "text").map((p) => p.text).join(" ");
      await eventBus.emitStatusUpdate({ kind: "status", status: { state: "working" } });
      await eventBus.emitArtifactUpdate({
        kind: "artifact",
        artifact: { parts: [{ kind: "text", text: `Hello! You said: "${text}"` }] },
      });
      await eventBus.emitStatusUpdate({ kind: "status", status: { state: "completed" }, final: true });
    },
  },
});

app.listen(3000);
```

---

## Features

### Core Protocol
- Canonical types & validation via Zod schemas aligned with the A2A spec
- JSON-RPC 2.0 transport with SSE streaming
- Full task state machine: `submitted → working → input-required → completed/failed/canceled/rejected/auth-required`

### Server Framework
- **Dual adapters** — Express 5 and Hono with feature parity
- **Extended Agent Card** — `/.well-known/agent-card/extended` + RPC
- **Health checks** — `/healthz` and `/readyz` endpoints
- **Rate limiting** — Sliding window rate limiter
- **Push notifications** — Webhook delivery with retry and auth
- **Graceful shutdown** — Drains SSE connections, finishes in-flight tasks

### Security
- **OAuth2** — Client credentials, authorization code, and refresh token flows
- **JWT** — RS256 validation with JWKS caching and scope extraction
- **API Key** — Header-based validation with configurable key sets
- **Mutual TLS** — Schema support in Agent Card security schemes
- **Agent Card signatures** — RSA/ECDSA/Ed25519 signature verification

### Persistence
- **InMemoryTaskStore** — Development and testing
- **FileSystemTaskStore** — JSON file persistence with periodic flush
- **RedisTaskStore** — Multi-instance production with ioredis
- **PostgresTaskStore** — Relational storage with auto-migration and transactions

### A2A ↔ MCP Bridge
- **A2A → MCP** — Expose A2A skills as MCP tools, forward tool calls
- **MCP → A2A** — Discover MCP tools as agent skills, invoke within A2A tasks

### Observability
- **Structured logging** — Pino with correlation IDs
- **OpenTelemetry hooks** — Pluggable `TelemetryProvider` for tracing and metrics
- **Task telemetry** — Counters, duration histograms, and span wrapping

---

## Packages

| Package | Description |
| ------- | ----------- |
| [`core`](./packages/core) | Canonical A2A types, Zod schemas, error classes, signature verification |
| [`server`](./packages/server) | A2A server framework (Express + Hono) |
| [`client`](./packages/client) | A2A client SDK |
| [`auth`](./packages/auth) | Pluggable authentication (OAuth2, JWT, API key) |
| [`persistence`](./packages/persistence) | Task stores (InMemory, FileSystem, Redis, PostgreSQL) |
| [`mcp-bridge`](./packages/mcp-bridge) | A2A ↔ MCP bidirectional adapter |
| [`observability`](./packages/observability) | Logging, telemetry, and metrics hooks |
| [`cli`](./packages/cli) | Agent scaffolding CLI tool |

---

## Documentation

| Document | Content |
| -------- | ------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, package boundaries, data flows |
| [docs/authentication.md](./docs/authentication.md) | Auth strategy deep dive (OAuth2, JWT, API key) |
| [docs/deployment.md](./docs/deployment.md) | Production deployment, health checks, rate limiting |
| [docs/protocol-compliance.md](./docs/protocol-compliance.md) | A2A spec compliance matrix |
| [docs/bridge-deep-dive.md](./docs/bridge-deep-dive.md) | A2A ↔ MCP bridge internals |
| [docs/edge-deployment.md](./docs/edge-deployment.md) | Serverless (CF Workers, Deno, Bun) |

---

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Language | TypeScript 5.8 (strict, no `any`) |
| Runtime | Node.js ≥ 20 |
| Package manager | pnpm 10 (workspaces) |
| Build | tsup + Turborepo |
| Lint & format | Biome |
| Testing | Vitest (>90% coverage) |
| Validation | Zod |
| Logging | Pino |

---

## License

[MIT](./LICENSE) © [Rick Somers](https://reaatech.com)
