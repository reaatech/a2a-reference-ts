# @reaatech/a2a-reference-client

[![npm version](https://img.shields.io/npm/v/@reaatech/a2a-reference-client.svg)](https://www.npmjs.com/package/@reaatech/a2a-reference-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/a2a-reference-ts/ci.yml?branch=main&label=CI)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

TypeScript client SDK for discovering A2A agents, submitting tasks, and consuming real-time Server-Sent Events (SSE) streams. Built on the standard `fetch` API with pluggable transport for edge runtimes and custom headers.

## Installation

```bash
npm install @reaatech/a2a-reference-client
# or
pnpm add @reaatech/a2a-reference-client
```

## Feature Overview

- **Agent discovery** — fetch and cache agent cards from `/.well-known/agent.json`
- **JSON-RPC 2.0 transport** — all task operations use standards-compliant RPC
- **SSE streaming** — `AsyncGenerator`-based consumption of status and artifact events
- **Automatic retry** — exponential backoff with jitter on 5xx errors and network failures
- **Pluggable fetch** — inject custom `fetchImpl` for edge runtimes, proxies, or auth headers
- **Full type safety** — all responses validated against Zod schemas from `@reaatech/a2a-reference-core`

## Quick Start

```typescript
import { A2AClient } from "@reaatech/a2a-reference-client";

// Discover an agent from its card URL
const client = await A2AClient.discover("http://localhost:3000");

// Or construct directly
const client = new A2AClient({ baseUrl: "http://localhost:3000" });

// Send a message and get the resulting task
const task = await client.sendMessage({
  messageId: "msg-1",
  role: "user",
  parts: [{ kind: "text", text: "Hello, agent!" }],
});

console.log(`Task ${task.id} is ${task.status.state}`);
```

## API Reference

### `A2AClient` (class)

#### Static Methods

| Method | Description |
|--------|-------------|
| `discover(cardUrl, fetchImpl?)` | Fetches agent card from `cardUrl`, validates it, returns a configured `A2AClient` |
| `fromCardUrl(cardUrl, fetchImpl?)` | Alias for `discover` |

#### Constructor

```typescript
new A2AClient(options: A2AClientOptions)
```

### `A2AClientOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `baseUrl` | `string` | (required) | Base URL of the A2A agent server |
| `fetchImpl` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation |
| `agentCardTtlMs` | `number` | `300000` (5 min) | Cache TTL for agent card |
| `maxRetries` | `number` | `0` | Max retry attempts for failed RPC calls |
| `retryDelayMs` | `number` | `1000` | Base delay for exponential backoff |

### Instance Methods — Discovery

| Method | Description |
|--------|-------------|
| `getAgentCard()` | Returns the cached agent card (fetches on first call) |
| `clearAgentCardCache()` | Invalidates the cached agent card |

### Instance Methods — Task Management

All methods use JSON-RPC 2.0 over `POST {baseUrl}`.

| Method | RPC Method | Returns | Description |
|--------|------------|---------|-------------|
| `sendMessage(message, contextId?, taskId?)` | `tasks/send` | `Task` | Start or continue a task |
| `getTask(taskId)` | `tasks/get` | `Task` | Retrieve a task by ID |
| `listTasks()` | `tasks/list` | `{ tasks, nextPageToken?, totalSize? }` | List all tasks (paginated) |
| `cancelTask(taskId)` | `tasks/cancel` | `Task` | Request cancellation |

### Instance Methods — SSE Streaming

Both methods check that the agent supports streaming (`capabilities.streaming`) and return `AsyncGenerator`s.

| Method | HTTP | Yields | Description |
|--------|------|--------|-------------|
| `sendSubscribe(message, contextId?)` | `POST /tasks/sendSubscribe` | `StreamEvent` | Send message + subscribe to stream |
| `subscribe(taskId)` | `GET /tasks/:taskId/subscribe` | `StreamEvent` | Subscribe to existing task stream |

### Stream Events

The `AsyncGenerator` yields a union of four event types, discriminated by `kind`:

```typescript
type StreamEvent =
  | TaskStatusUpdateEvent   // { kind: "status", taskId?, status, final? }
  | TaskArtifactUpdateEvent // { kind: "artifact", taskId?, artifact, append?, lastChunk? }
  | { kind: "task", task: Task }
  | { kind: "message", message: Message };
```

## Usage Patterns

### Streaming Task Progress

```typescript
const client = new A2AClient({ baseUrl: "http://localhost:3000" });

for await (const event of client.sendSubscribe({
  messageId: "stream-1",
  role: "user",
  parts: [{ kind: "text", text: "Count to 10" }],
})) {
  if (event.kind === "status") {
    console.log(`Status: ${event.status.state}`);
  } else if (event.kind === "artifact") {
    const text = event.artifact.parts
      .filter((p) => p.kind === "text")
      .map((p) => p.text)
      .join(" ");
    console.log(`Output: ${text}`);
  }
}
```

### Custom Fetch (Auth Headers, Edge Runtimes)

```typescript
import { A2AClient } from "@reaatech/a2a-reference-client";

const client = new A2AClient({
  baseUrl: "http://localhost:3000",
  fetchImpl: (url, init) =>
    globalThis.fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        "x-api-key": process.env.A2A_API_KEY,
      },
    }),
});

const card = await client.getAgentCard();
```

### Retry with Backoff

```typescript
const client = new A2AClient({
  baseUrl: "http://localhost:3000",
  maxRetries: 3,
  retryDelayMs: 500,
});

// RPC calls automatically retry on 5xx and network errors
const task = await client.sendMessage({
  messageId: "retry-1",
  role: "user",
  parts: [{ kind: "text", text: "do work" }],
});
```

### Multi-Agent Orchestration

```typescript
const mathClient = new A2AClient({ baseUrl: "http://localhost:3001" });
const formatterClient = new A2AClient({ baseUrl: "http://localhost:3002" });

// Delegate to math agent
const mathTask = await mathClient.sendMessage({
  messageId: "math-1",
  role: "user",
  parts: [{ kind: "text", text: "2 + 2" }],
});

// Poll for result
let result = mathTask;
while (result.status.state !== "completed" && result.status.state !== "failed") {
  await sleep(100);
  result = await mathClient.getTask(mathTask.id);
}
```

## Error Handling

The client throws typed errors from `@reaatech/a2a-reference-core`:

| Error | When |
|-------|------|
| `TaskNotFoundError` | Server returns "not found" for a task ID |
| `UnsupportedOperationError` | Streaming requested but agent doesn't support it |
| `InvalidAgentResponseError` | Server response fails Zod validation |

Retry behavior:
- **5xx responses**: retried with exponential backoff + jitter
- **4xx responses**: not retried (client error)
- **Network errors** (`ECONNREFUSED`, `fetch failed`): retried
- **Timeout**: 30-second `AbortController` per RPC call

## Related Packages

- [`@reaatech/a2a-reference-core`](https://www.npmjs.com/package/@reaatech/a2a-reference-core) — Protocol types and Zod schemas
- [`@reaatech/a2a-reference-server`](https://www.npmjs.com/package/@reaatech/a2a-reference-server) — Server framework
- [`@reaatech/a2a-reference-auth`](https://www.npmjs.com/package/@reaatech/a2a-reference-auth) — Authentication strategies

## License

[MIT](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
