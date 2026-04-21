# ARCHITECTURE.md — a2a-reference-ts

> System-level design for the A2A reference implementation.

## Overview

This monorepo implements Google's Agent-to-Agent (A2A) protocol in TypeScript with an enterprise-grade A2A↔MCP bridge adapter.

## Package Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                        A2A Server                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Express    │  │    Hono     │  │   AgentExecutor     │  │
│  │  Adapter    │  │   Adapter   │  │   (user logic)      │  │
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
        ┌─────────┐    ┌──────────┐    ┌──────────┐
        │  Auth   │    │Persistence│   │Observability│
        └─────────┘    └──────────┘    └──────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    A2A ↔ MCP Bridge                         │
│           (bidirectional protocol adapter)                  │
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
Client ──POST /──► Server ──► AgentExecutor
                     │
                     ├──► SSE: TaskStatusUpdateEvent
                     ├──► SSE: TaskArtifactUpdateEvent
                     └──► SSE: TaskStatusUpdateEvent (completed)
```

### Bridge: A2A → MCP

```
A2A Task ──► BridgeAgent ──► tools/list ──► MCP Server
                │
                ├──► Map skills ◄── tools schema
                │
                └──► tools/call ──► MCP Server ──► Result ──► A2A Artifact
```

## State Machine

```
                    ┌──────────┐
         ┌─────────►│ submitted │◄────────┐
         │          └────┬─────┘         │
         │               │               │
         │               ▼               │
         │          ┌─────────┐         │
         │    ┌────►│ working │────┐    │
         │    │     └────┬────┘    │    │
         │    │          │         │    │
         │    │          ▼         │    │
         │    │   ┌─────────────┐  │    │
         │    └───│ input-required│──┘    │
         │        └──────┬──────┘         │
         │               │                │
         │               ▼                │
         │      ┌─────────────────┐      │
         └──────│ completed/failed │──────┘
                │  /canceled/rejected │
                └─────────────────┘
```

## Technology Choices

See [DEV_PLAN.md](./DEV_PLAN.md) Section 2.2 for the full technology stack rationale.

## Extension Points

- **AuthStrategy** — implement custom auth schemes
- **TaskStore** — add new persistence backends
- **AgentExecutor** — implement agent logic
- **TransportAdapter** — add new HTTP frameworks
