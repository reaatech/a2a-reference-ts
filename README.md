# a2a-reference-ts

[![CI](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)

> Production-ready TypeScript implementation of the [Agent-to-Agent (A2A) protocol](https://github.com/google/A2A), with a bidirectional **A2A ↔ MCP bridge**.

This monorepo provides canonical types, a server framework, a client SDK, and supporting infrastructure for building interoperable AI agents that communicate over the A2A protocol.

## Features

- **Canonical types & validation** — Zod schemas derived from the A2A protocol specification
- **Server framework** — Express and Hono adapters with JSON-RPC routing, SSE streaming, and task lifecycle management
- **Client SDK** — Type-safe agent discovery, task submission, and streaming event consumption
- **Authentication** — Pluggable strategies including OAuth2, JWT, and API key verification
- **Persistence** — In-memory and Redis-backed task stores with consistent abstractions
- **A2A ↔ MCP bridge** — Bidirectional adapter enabling A2A agents to invoke MCP tools and MCP clients to interact with A2A agents
- **Observability** — Structured logging with Pino, built-in tracing hooks, and Prometheus-compatible metrics endpoints

## Installation

### Using the packages

Packages are published under the `@a2a-ref` scope and can be installed individually:

```bash
# Core types and schemas
pnpm add @a2a-ref/core

# Server framework
pnpm add @a2a-ref/server

# Client SDK
pnpm add @a2a-ref/client

# Authentication strategies
pnpm add @a2a-ref/auth

# Task persistence
pnpm add @a2a-ref/persistence

# A2A ↔ MCP bridge
pnpm add @a2a-ref/mcp-bridge

# Observability utilities
pnpm add @a2a-ref/observability
```

### Contributing

```bash
# Clone the repository
git clone https://github.com/reaatech/a2a-reference-ts.git
cd a2a-reference-ts

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the test suite
pnpm test

# Run linting
pnpm lint
```

## Quick Start

Create a minimal A2A agent with the server framework:

```typescript
import { createA2AServer } from "@a2a-ref/server";
import { z } from "zod";

const server = createA2AServer({
  name: "greeter",
  description: "A simple agent that greets users",
  skills: [
    {
      id: "greet",
      name: "Greet User",
      description: "Returns a personalized greeting",
      parameters: z.object({ name: z.string() }),
      handler: async ({ params }) => ({
        artifact: {
          parts: [{ type: "text", text: `Hello, ${params.name}!` }],
        },
      }),
    },
  ],
});

server.listen(3000, () => console.log("A2A agent running on :3000"));
```

See the [`examples/`](./examples/) directory for complete working samples, including task streaming, multi-agent workflows, MCP bridging, and authenticated agents.

## Packages

| Package | Description |
| ------- | ----------- |
| [`@a2a-ref/core`](./packages/core) | Canonical A2A types and Zod schemas |
| [`@a2a-ref/server`](./packages/server) | A2A server framework (Express + Hono) |
| [`@a2a-ref/client`](./packages/client) | A2A client SDK |
| [`@a2a-ref/auth`](./packages/auth) | Pluggable authentication strategies |
| [`@a2a-ref/persistence`](./packages/persistence) | Task store abstractions |
| [`@a2a-ref/mcp-bridge`](./packages/mcp-bridge) | A2A ↔ MCP bidirectional adapter |
| [`@a2a-ref/observability`](./packages/observability) | Logging, tracing, and metrics |

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — System design, package relationships, and data flows
- [`AGENTS.md`](./AGENTS.md) — Coding conventions and development guidelines
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Contribution workflow and release process
- [`docs/`](./docs/) — Deep dives on authentication, deployment, protocol compliance, and the MCP bridge

## License

[MIT](LICENSE)
