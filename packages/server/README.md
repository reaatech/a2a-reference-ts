# @reaatech/a2a-reference-server

[![npm version](https://img.shields.io/npm/v/@reaatech/a2a-reference-server.svg)](https://www.npmjs.com/package/@reaatech/a2a-reference-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/a2a-reference-ts/ci.yml?branch=main&label=CI)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

A2A server framework for building interoperable AI agents. Provides Express and Hono adapters with JSON-RPC 2.0 routing, Server-Sent Events (SSE) streaming, task lifecycle management, and pluggable authentication.

## Installation

```bash
npm install @reaatech/a2a-reference-server
# or
pnpm add @reaatech/a2a-reference-server
```

## Feature Overview

- **Express 5 and Hono 4 adapters** — choose the framework that fits your stack
- **JSON-RPC 2.0 routing** — standards-compliant method dispatch with schema validation
- **SSE streaming** — real-time task status and artifact updates to connected clients
- **Task lifecycle** — built-in state machine with validated transitions
- **Pluggable persistence** — swap in-memory, file-system, or Redis task stores
- **Pluggable authentication** — integrate API key, JWT, or custom auth strategies
- **Graceful shutdown** — drains in-flight tasks and closes SSE connections cleanly

## Quick Start

Create an A2A agent with a single skill in under 30 lines:

```typescript
import { createA2AExpressApp } from "@reaatech/a2a-reference-server";
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from "@reaatech/a2a-reference-server";

const agentCard = {
  name: "Greeter",
  description: "A friendly agent that greets users",
  url: "http://localhost:3000",
  version: "1.0.0",
  protocolVersion: "0.3.0",
  capabilities: { streaming: false },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "greet",
      name: "Greet User",
      description: "Returns a personalized greeting",
      tags: ["greeting"],
      examples: ["Hello!", "Say hi"],
    },
  ],
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
      artifact: {
        name: "response",
        parts: [{ kind: "text", text: `Hello! You said: "${text}"` }],
      },
    });
    eventBus.emitStatusUpdate({ kind: "status", status: { state: "completed" } });
  },
};

const app = createA2AExpressApp({ agentCard, executor });
app.listen(3000, () => console.log("A2A agent listening on :3000"));
```

## Using Hono

```typescript
import { createA2AHonoApp } from "@reaatech/a2a-reference-server";

const app = createA2AHonoApp({ agentCard, executor });
export default app;
```

## API Reference

### Express Adapter

#### `createA2AExpressApp(options: A2AServerOptions): Express & { shutdown }`

Creates a fully configured Express 5 application with all A2A routes, JSON body parsing, and graceful shutdown.

#### `createA2ARouter(options: A2AServerOptions): Router & { shutdownSse }`

Creates an Express Router with A2A endpoints. Mount it on an existing Express app under a path prefix.

#### `A2AServerOptions`

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `agentCard` | `AgentCard` | Yes | The agent's metadata card describing capabilities, skills, and interfaces |
| `executor` | `AgentExecutor` | Yes | Your task execution logic |
| `taskStore` | `TaskStore` | No | Persistence layer; defaults to `InMemoryTaskStore` |
| `authStrategy` | `AuthStrategy` | No | Authentication strategy from `@reaatech/a2a-reference-auth` |

#### `A2AServerShutdownOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `timeoutMs` | `number` | `10000` | Max ms to wait for in-flight tasks during shutdown |

### Hono Adapter

#### `createA2AHonoApp(options: A2AHonoOptions): Hono & { shutdown }`

Creates a fully configured Hono application with A2A routes and SSE streaming via `ReadableStream`.

#### `A2AHonoOptions`

Same shape as `A2AServerOptions`. See above.

#### `A2AHonoShutdownOptions`

Same as `A2AServerShutdownOptions`. See above.

### Execution Model

#### `AgentExecutor`

Your implementation contract:

```typescript
interface AgentExecutor {
  execute(context: ExecutionContext, eventBus: ExecutionEventBus): Promise<void>;
  cancelTask?(taskId: string, eventBus: ExecutionEventBus): Promise<void>;
}
```

#### `ExecutionContext`

| Property | Type | Description |
|----------|------|-------------|
| `task` | `Task` | The task object at creation time |
| `message` | `Message` | The triggering user message with its `parts` array |

#### `ExecutionEventBus`

The channel for reporting progress back to the server:

| Method | Description |
|--------|-------------|
| `emitStatusUpdate(event: TaskStatusUpdateEvent)` | Update task status, validate transition, broadcast to SSE subscribers |
| `emitArtifactUpdate(event: TaskArtifactUpdateEvent)` | Persist and broadcast an artifact to SSE subscribers |

### JSON-RPC Router

The `JsonRpcRouter<T>` class provides generic JSON-RPC 2.0 dispatch with context support:

```typescript
import { JsonRpcRouter } from "@reaatech/a2a-reference-server";

const router = new JsonRpcRouter<string>();

router.register("myMethod", async (params, context) => {
  // context === "some-context"
  return { success: true };
});

const response = await router.handle(
  { jsonrpc: "2.0", method: "myMethod", params: { key: "value" }, id: 1 },
  "some-context"
);
```

| Method | Description |
|--------|-------------|
| `register(method, handler)` | Register a named JSON-RPC 2.0 method handler |
| `handle(request, context?)` | Parse, validate, dispatch, and return a JSON-RPC 2.0 response |

Error codes: `-32700` (parse), `-32601` (method not found), `-32602` (invalid params), `-32603` (internal).

### Server Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/.well-known/agent.json` | Returns the `AgentCard` as JSON |
| `GET` | `/.well-known/agent-card` | Alternative discovery endpoint |
| `POST` | `/` | JSON-RPC 2.0 endpoint (dispatches `tasks/send`, `tasks/get`, `tasks/list`, `tasks/cancel`) |
| `POST` | `/tasks/sendSubscribe` | Creates a task and returns an SSE event stream |
| `GET` | `/tasks/:taskId/subscribe` | Subscribes to SSE updates for an existing task |

### Task State Machine

Valid state transitions are enforced automatically:

```
submitted → working, input-required, completed, failed, canceled, rejected
working   → input-required, completed, failed, canceled
input-required → working, completed, failed, canceled
completed, failed, canceled, rejected → (terminal)
```

### Graceful Shutdown

```typescript
// Gracefully stop the server
await app.shutdown({ timeoutMs: 5000 });

// Or just close SSE connections without waiting for tasks
await app.shutdownSse();
```

## Advanced: Streaming Tasks

```typescript
const executor: AgentExecutor = {
  async execute(context: ExecutionContext, eventBus: ExecutionEventBus) {
    eventBus.emitStatusUpdate({ kind: "status", status: { state: "working" } });

    for (let i = 1; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 500));
      eventBus.emitArtifactUpdate({
        kind: "artifact",
        artifact: {
          name: "progress",
          parts: [{ kind: "text", text: `Step ${i} of 5 complete` }],
        },
      });
    }

    eventBus.emitArtifactUpdate({
      kind: "artifact",
      artifact: {
        name: "result",
        parts: [{ kind: "text", text: "All steps finished!" }],
      },
    });
    eventBus.emitStatusUpdate({ kind: "status", status: { state: "completed" } });
  },
};
```

## Advanced: Authentication

```typescript
import { ApiKeyStrategy } from "@reaatech/a2a-reference-auth";

const authStrategy = new ApiKeyStrategy({
  keys: new Set(["my-secret-key"]),
});

const app = createA2AExpressApp({ agentCard, executor, authStrategy });
```

## Advanced: Persistent Storage

```typescript
import { FileSystemTaskStore } from "@reaatech/a2a-reference-persistence";

const taskStore = new FileSystemTaskStore({ path: "./tasks.json" });
await taskStore.load();

const app = createA2AExpressApp({ agentCard, executor, taskStore });

// On shutdown
await taskStore.close();
```

## Related Packages

- [`@reaatech/a2a-reference-core`](https://www.npmjs.com/package/@reaatech/a2a-reference-core) — Protocol types and Zod schemas
- [`@reaatech/a2a-reference-client`](https://www.npmjs.com/package/@reaatech/a2a-reference-client) — Client SDK
- [`@reaatech/a2a-reference-auth`](https://www.npmjs.com/package/@reaatech/a2a-reference-auth) — Authentication strategies
- [`@reaatech/a2a-reference-persistence`](https://www.npmjs.com/package/@reaatech/a2a-reference-persistence) — Task store implementations

## License

[MIT](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
