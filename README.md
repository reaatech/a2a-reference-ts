# a2a-reference-ts

> Enterprise-grade TypeScript reference implementation of Google's Agent-to-Agent (A2A) protocol, with a production-ready **A2A ↔ MCP bridge adapter**.

[![CI](https://github.com/a2aproject/a2a-reference-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/a2aproject/a2a-reference-ts/actions/workflows/ci.yml)

## Why this exists

Google published the A2A spec. A few Python demos and early JS SDKs exist. But **no one has built a serious, production-ready TypeScript implementation** with:

- Enterprise authentication (OAuth2, API keys, JWT)
- Persistent task lifecycle with Redis/Postgres
- Real-time SSE streaming
- **A2A ↔ MCP bridge** — so A2A agents can call MCP tools and vice versa
- Observability, tracing, and metrics

This repo is that implementation.

## Quickstart

```bash
# Clone and install
pnpm install

# Build everything
pnpm build

# Run the hello agent example
pnpm --filter @a2a-ref/example-hello-agent dev
```

## Architecture

This is a pnpm workspace monorepo:


| Package                  | Description                           |
| ------------------------ | ------------------------------------- |
| `@a2a-ref/core`          | Canonical A2A types & Zod schemas     |
| `@a2a-ref/server`        | A2A server framework (Express + Hono) |
| `@a2a-ref/client`        | A2A client SDK                        |
| `@a2a-ref/auth`          | Pluggable authentication              |
| `@a2a-ref/persistence`   | Task store abstractions               |
| `@a2a-ref/mcp-bridge`    | **A2A ↔ MCP bidirectional adapter**  |
| `@a2a-ref/observability` | Logging, tracing, metrics             |

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System design and data flows
- [AGENTS.md](./AGENTS.md) — Agent coding conventions
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contributor guide

## License

Apache-2.0
