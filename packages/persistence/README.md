# @reaatech/a2a-reference-persistence

[![npm version](https://img.shields.io/npm/v/@reaatech/a2a-reference-persistence.svg)](https://www.npmjs.com/package/@reaatech/a2a-reference-persistence)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/a2a-reference-ts/ci.yml?branch=main&label=CI)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Task store abstractions for persisting A2A task state. Provides a consistent `TaskStore` interface with three implementations: in-memory (zero-dependency), file-system (single JSON file), and Redis (via ioredis).

## Installation

```bash
npm install @reaatech/a2a-reference-persistence
# or
pnpm add @reaatech/a2a-reference-persistence
```

For Redis support, install `ioredis`:

```bash
npm install ioredis
```

## Feature Overview

- **Single abstraction** — `TaskStore` interface defines 8 methods shared by all implementations
- **In-memory store** — fast, ephemeral, zero dependencies beyond `@reaatech/a2a-reference-core`
- **File-system store** — persists to a single JSON file, write-through on every mutation
- **Redis store** — distributed, persistent, suitable for multi-process deployments
- **History truncation** — automatic enforcement of `historyLength` caps
- **Paginated listing** — cursor-based pagination with `contextId` and `status` filtering

## Quick Start

```typescript
import {
  InMemoryTaskStore,
  FileSystemTaskStore,
  RedisTaskStore,
} from "@reaatech/a2a-reference-persistence";
import Redis from "ioredis";

// In-memory (ephemeral, no setup)
const memoryStore = new InMemoryTaskStore();

// File-system (persistent, single JSON file)
const fileStore = new FileSystemTaskStore({ path: "./tasks.json" });
await fileStore.load();

// Redis (distributed, production)
const redis = new Redis("redis://localhost:6379");
const redisStore = new RedisTaskStore({ redis });
```

## API Reference

### `TaskStore` Interface

The contract that all implementations fulfill:

```typescript
interface TaskStore {
  create(task: Task): Promise<void>;
  get(id: string, options?: { historyLength?: number }): Promise<Task | undefined>;
  update(id: string, updates: Partial<Task> | ((task: Task) => Task)): Promise<Task | undefined>;
  list(options?: {
    contextId?: string;
    status?: TaskStatus;
    pageSize?: number;
    pageToken?: string;
    historyLength?: number;
  }): Promise<{ tasks: Task[]; nextPageToken: string; totalSize: number }>;
  cancel(id: string): Promise<Task | undefined>;
  addHistory(id: string, message: Message): Promise<void>;
  addArtifact(id: string, artifact: Artifact): Promise<void>;
  updateStatus(id: string, status: TaskStatus): Promise<void>;
}
```

| Method | Description |
|--------|-------------|
| `create` | Persist a new task |
| `get` | Retrieve a task by ID with optional history truncation |
| `update` | Partial update or function-based update |
| `list` | Paginated listing with optional filters |
| `cancel` | Cancel a task (no-op if already terminal) |
| `addHistory` | Append a message to the task's history |
| `addArtifact` | Append an artifact to the task |
| `updateStatus` | Replace the task's status object |

### `InMemoryTaskStore`

Ephemeral `Map`-backed store. Ideal for development and testing.

```typescript
const store = new InMemoryTaskStore();

await store.create(task);
const t = await store.get("task-abc123");
const { tasks, nextPageToken, totalSize } = await store.list({ pageSize: 10 });
```

- No constructor arguments
- Data is lost on process exit
- No cleanup or connection management required

### `FileSystemTaskStore`

Persists tasks to a single JSON file with write-through on every mutation.

```typescript
const store = new FileSystemTaskStore({ path: "./data/tasks.json" });
await store.load();           // Hydrate from disk (idempotent — creates file if missing)
// ... use the store ...
await store.close();          // Flush and stop periodic sync
```

#### `FileSystemTaskStoreOptions`

| Property | Type | Description |
|----------|------|-------------|
| `path` | `string` | File path to the JSON store file |

Key behaviors:
- **Write-through** — every mutation immediately writes the full JSON file
- **Periodic flush** — a 5-second interval ensures data is synced even if a write is missed
- **Error tolerance** — missing files on `load()` initialize an empty store without error
- **Shutdown** — call `close()` before process exit to flush pending writes

### `RedisTaskStore`

Redis-backed store using [ioredis](https://github.com/redis/ioredis). Suitable for distributed, multi-process deployments.

```typescript
import Redis from "ioredis";

const redis = new Redis({
  host: "localhost",
  port: 6379,
  password: "optional",
});

const store = new RedisTaskStore({ redis, keyPrefix: "a2a" });
// ... use the store ...
await store.close(); // Calls redis.quit()
```

#### `RedisTaskStoreOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `redis` | `Redis` | (required) | Pre-configured ioredis client instance |
| `keyPrefix` | `string` | `"a2a"` | Prefix for all Redis keys |

Key schema:
- `<prefix>:task:<id>` — JSON-serialized task objects
- `<prefix>:tasks` — Redis set tracking all task IDs for enumeration

## Integration with the Server

```typescript
import { createA2AExpressApp } from "@reaatech/a2a-reference-server";
import { FileSystemTaskStore } from "@reaatech/a2a-reference-persistence";

const taskStore = new FileSystemTaskStore({ path: "./tasks.json" });
await taskStore.load();

const app = createA2AExpressApp({ agentCard, executor, taskStore });

// Graceful shutdown
process.on("SIGTERM", async () => {
  await app.shutdown();
  await taskStore.close();
  process.exit(0);
});

app.listen(3000);
```

## Choosing a Store

| Store | Use Case |
|-------|----------|
| `InMemoryTaskStore` | Development, testing, single-process prototypes |
| `FileSystemTaskStore` | Single-server deployments, simple persistence needs |
| `RedisTaskStore` | Multi-process deployments, horizontal scaling, production |

All three implement the same interface — swap them without changing application code.

## Related Packages

- [`@reaatech/a2a-reference-core`](https://www.npmjs.com/package/@reaatech/a2a-reference-core) — Protocol types (`Task`, `Message`, `Artifact`, `TaskStatus`)
- [`@reaatech/a2a-reference-server`](https://www.npmjs.com/package/@reaatech/a2a-reference-server) — Server framework that consumes `TaskStore`

## License

[MIT](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
