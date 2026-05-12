# a2a-reference-ts

[![CI](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.22-orange)](https://pnpm.io/)
[![Vitest](https://img.shields.io/badge/test-vitest-green)](https://vitest.dev/)

> **Production-ready TypeScript reference implementation of the [Agent-to-Agent (A2A) protocol](https://github.com/google/A2A)** — server framework, client SDK, and a bidirectional A2A ↔ MCP bridge, all in one monorepo.

---

## Why a2a-reference-ts?

The A2A protocol defines how AI agents discover each other, exchange messages, and manage task lifecycles. This project provides the canonical TypeScript implementation — battle-tested Zod schemas, pluggable server adapters, a type-safe client, and infrastructure for authentication, persistence, and observability.

It also includes a **bidirectional A2A ↔ MCP bridge**, allowing A2A agents to call MCP tools and MCP hosts to delegate work to A2A agents. If you're building interoperable agent systems, this is your starting point.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        A2A Server                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Express    │  │    Hono     │  │   AgentExecutor     │  │
│  │  Adapter    │  │   Adapter   │  │   (your logic)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      A2A Client SDK                         │
│         (discovery, task lifecycle, streaming)              │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌─────────┐    ┌──────────┐    ┌──────────────┐
        │  Auth   │    │Persistence│   │ Observability │
        └─────────┘    └──────────┘    └──────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    A2A ↔ MCP Bridge                         │
│           (bidirectional protocol adapter)                  │
└─────────────────────────────────────────────────────────────┘
```

Data flows: [ARCHITECTURE.md](./ARCHITECTURE.md) covers sync JSON-RPC, SSE streaming, A2A → MCP tool calls, and the task state machine in depth.

---

## Features

### Core Protocol
- **Canonical types & validation** — Zod schemas derived directly from the A2A protocol specification (`proto/`)
- **Typed error hierarchy** — `A2AError` subclasses with error codes for every protocol-defined failure mode
- **JSON-RPC 2.0 transport** — Request/response and streaming via Server-Sent Events (SSE)

### Server Framework
- **Dual HTTP adapters** — Express 5 and Hono, with a shared transport-agnostic core
- **Task lifecycle management** — Full state machine: `submitted → working → input-required → completed/failed/canceled`
- **Pluggable executors** — Implement `AgentExecutor` to define agent behavior; framework handles protocol wiring
- **Agent cards** — Automatic `/.well-known/agent.json` discovery endpoint

### Client SDK
- **Type-safe discovery** — Fetch and validate agent cards with Zod
- **Task submission** — `sendMessage` (sync) and `sendSubscribe` (SSE streaming)
- **Streaming consumption** — `for await...of` iterator over task events

### Security
- **Pluggable auth strategies** — OAuth2, JWT, and API key verification out of the box
- **Custom strategy support** — Implement `AuthStrategy` for bespoke auth schemes

### Persistence
- **Task store abstraction** — Consistent interface across backends
- **Batteries included** — In-memory store (dev/testing) and Redis-backed store (production)

### A2A ↔ MCP Bridge
- **A2A → MCP** — Expose A2A skills as MCP tools, forward tool calls to agent executors
- **MCP → A2A** — Discover MCP tools as agent skills, invoke them from within A2A tasks
- **Zero-copy passthrough** — Message parts flow directly between protocols

### Observability
- **Structured logging** — Pino-based JSON logging with configurable levels
- **Tracing hooks** — Instrumentation points for request lifecycle, task transitions, and errors
- **Metrics** — Prometheus-compatible counters, histograms, and gauges

---

## Installation

### Using published packages

All packages are published under `@reaatech`:

```bash
# Core types and schemas
pnpm add @reaatech/a2a-reference-core

# Server framework
pnpm add @reaatech/a2a-reference-server

# Client SDK
pnpm add @reaatech/a2a-reference-client

# Authentication
pnpm add @reaatech/a2a-reference-auth

# Task persistence
pnpm add @reaatech/a2a-reference-persistence

# A2A ↔ MCP bridge
pnpm add @reaatech/a2a-reference-mcp-bridge

# Observability
pnpm add @reaatech/a2a-reference-observability
```

### Local development

```bash
git clone https://github.com/reaatech/a2a-reference-ts.git
cd a2a-reference-ts
pnpm install        # install all workspace dependencies
pnpm build          # build all packages
pnpm test           # run the full test suite
pnpm lint           # lint and check formatting
pnpm typecheck      # type-check without emitting
```

---

## Quick Start

### Hello Agent (Express)

```typescript
import { createA2AExpressApp } from "@reaatech/a2a-reference-server";
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from "@reaatech/a2a-reference-server";

const agentCard = {
  name: "Hello Agent",
  description: "A friendly agent that echoes your message back",
  url: "http://localhost:3000",
  version: "1.0.0",
  protocolVersion: "0.3.0",
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [{ id: "echo", name: "Echo", description: "Echo a message back", tags: ["echo"], examples: ["Hello!"] }],
  supportedInterfaces: [{ url: "http://localhost:3000", protocolBinding: "a2a", protocolVersion: "0.3.0" }],
};

const executor: AgentExecutor = {
  async execute(context: ExecutionContext, eventBus: ExecutionEventBus) {
    const text = context.message.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join(" ");

    eventBus.emitStatusUpdate({ kind: "status", status: { state: "working" } });
    eventBus.emitArtifactUpdate({
      kind: "artifact",
      artifact: { name: "response", parts: [{ kind: "text", text: `Hello! You said: "${text}"` }] },
    });
    eventBus.emitStatusUpdate({ kind: "status", status: { state: "completed" } });
  },
};

const app = createA2AExpressApp({ agentCard, executor });
app.listen(3000, () => console.log("Agent running at http://localhost:3000"));
```

### Client Usage

```typescript
import { A2AClient } from "@reaatech/a2a-reference-client";

const client = new A2AClient({ baseUrl: "http://localhost:3000" });

// Sync request
const task = await client.sendMessage({
  messageId: crypto.randomUUID(),
  role: "user",
  parts: [{ kind: "text", text: "Hello!" }],
});
console.log(task.artifacts?.[0]?.parts);

// Streaming (SSE)
for await (const event of client.sendSubscribe({
  messageId: crypto.randomUUID(),
  role: "user",
  parts: [{ kind: "text", text: "Count to 5" }],
})) {
  if (event.kind === "artifact") {
    console.log(event.artifact.parts);
  }
}
```

---

## Packages

| Package | Description | Dependencies |
| ------- | ----------- | ------------ |
| [`core`](./packages/core) | Canonical A2A types, Zod schemas, error classes | `zod` |
| [`server`](./packages/server) | A2A server framework (Express + Hono) | `core`, `auth`, `persistence`, `observability` |
| [`client`](./packages/client) | A2A client SDK | `core` |
| [`auth`](./packages/auth) | Pluggable authentication strategies | `jose` |
| [`persistence`](./packages/persistence) | Task store abstractions (in-memory + Redis) | `core`, `ioredis` |
| [`mcp-bridge`](./packages/mcp-bridge) | A2A ↔ MCP bidirectional adapter | `core`, `client`, `observability`, `@modelcontextprotocol/sdk` |
| [`observability`](./packages/observability) | Structured logging, tracing, and metrics | `pino` |

---

## Examples

Runnable examples live in the [`examples/`](./examples/) directory:

| Example | Description |
| ------- | ----------- |
| [`01-hello-agent`](./examples/01-hello-agent) | Minimal echo agent — the simplest possible A2A server |
| [`02-task-streaming`](./examples/02-task-streaming) | SSE streaming with progress updates and a client-side consumer |
| [`03-multi-agent-workflow`](./examples/03-multi-agent-workflow) | Orchestrator pattern — one agent delegates to specialist agents via the client SDK |
| [`04-mcp-bridge`](./examples/04-mcp-bridge) | A2A ↔ MCP bridge in both directions |
| [`05-auth-workflow`](./examples/05-auth-workflow) | Auth-protected agent with API key and JWT strategies |

Each example has its own `README.md` with run instructions.

---

## Documentation

| Document | Content |
| -------- | ------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, package boundaries, data flows, state machine |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Development setup, conventional commits, PR process, releasing |
| [AGENTS.md](./AGENTS.md) | Coding conventions, tooling, and conventions for AI agents |
| [docs/deployment.md](./docs/deployment.md) | Production deployment patterns |
| [docs/authentication.md](./docs/authentication.md) | Auth strategy deep dive |
| [docs/protocol-compliance.md](./docs/protocol-compliance.md) | A2A protocol compliance matrix |
| [docs/bridge-deep-dive.md](./docs/bridge-deep-dive.md) | A2A ↔ MCP bridge internals |

---

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Language | TypeScript 5.8 (strict mode) |
| Runtime | Node.js ≥ 18 |
| Package manager | pnpm 10 (workspaces) |
| Build | tsup + Turborepo |
| Lint & format | Biome |
| Testing | Vitest |
| Validation | Zod |
| Logging | Pino |
| Versioning | Changesets |

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow:

1. Fork the repo, create a feature branch
2. Write code with tests (`vitest`), lint with `biome`
3. Run `pnpm lint && pnpm test` before committing
4. Use [Conventional Commits](https://www.conventionalcommits.org/)
5. Open a PR

Coding conventions and project guidance live in [AGENTS.md](./AGENTS.md).

---

## License

[MIT](./LICENSE) © [Rick Somers](https://reaatech.com)
