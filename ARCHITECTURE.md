# ARCHITECTURE.md — a2a-reference-ts

> System-level design for the A2A reference implementation.

## Overview

This monorepo implements Google's Agent-to-Agent (A2A) protocol in TypeScript with an enterprise-grade A2A↔MCP bridge adapter, CLI scaffolding, and production infrastructure.

## Package Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                      A2A Server (Express + Hono)             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Agent Card  │  │   JSON-RPC  │  │   AgentExecutor     │  │
│  │  / Health   │  │  / SSE / PN │  │   (user logic)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
       │           │           │
       ▼           ▼           ▼
┌─────────┐ ┌──────────┐ ┌──────────┐
│  Auth    │ │Persistence│ │Observability│
│ OAuth2   │ │InMemory   │ │ Pino     │
│ JWT      │ │Redis      │ │ OTel     │
│ API Key  │ │Postgres   │ │ Metrics  │
│          │ │FileSystem │ │          │
└─────────┘ └──────────┘ └──────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                    A2A ↔ MCP Bridge                         │
│   McpToolAdapter (A2A→MCP) + A2aAsMcpServer (MCP→A2A)      │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Sync Task (JSON-RPC)
```
Client ──POST /──► Server ──► AgentExecutor ──► TaskStore
                     │                            │
                     └──────JSON-RPC Response◄────┘
```

### Streaming Task (SSE)
```
Client ──POST /tasks/sendSubscribe ──► Server ──► AgentExecutor
                     │
                     ├──► SSE: TaskStatusUpdateEvent (working)
                     ├──► SSE: TaskArtifactUpdateEvent (artifact data)
                     └──► SSE: TaskStatusUpdateEvent (completed/failed)
```

### Push Notifications
```
Agent ──► PushNotificationManager ──► HTTP POST ──► Client Webhook
                │
                ├──► Bearer token auth header
                └──► Retry with exponential backoff (3 attempts)
```

### Rate Limiting
```
Request ──► RateLimiter.check() ──► allowed? ──► 200 (with X-RateLimit-Remaining)
                                      │
                                      └──► denied? ──► 429 (with Retry-After)
```

## Health Checks
```
GET /healthz ──► createHealthStatus() ──► Check task store
                  │                         ├── Custom health checks
                  └──► JSON: { status: "ok", checks: [...] }
```

## State Machine

```
                    ┌──────────┐
         ┌─────────►│ submitted │◄────────┐
         │          └────┬─────┘         │
         │               │               │
         │               ▼               │
         │          ┌─────────┐          │
         │    ┌────►│ working │────┐     │
         │    │     └────┬────┘    │     │
         │    │          │         │     │
         │    │          ▼         │     │
         │    │   ┌─────────────┐  │     │
         │    └───│input-required│──┘     │
         │        └──────┬──────┘         │
         │               │                │
         │          ┌────▼─────┐          │
         │          │auth-required        │
         │          └────┬─────┘          │
         │               │                │
         │               ▼                │
         │      ┌─────────────────┐      │
         └──────│ completed/failed│──────┘
                │ /canceled/rejected │
                └─────────────────┘
```

## Extension Points

- **AuthStrategy** — implement custom auth schemes (OAuth2, JWT, API key)
- **TaskStore** — add new persistence backends (InMemory, Redis, Postgres, FileSystem)
- **AgentExecutor** — implement agent business logic
- **TelemetryProvider** — plug in OpenTelemetry or custom observability
- **RateLimiter** — custom key functions and window strategies
