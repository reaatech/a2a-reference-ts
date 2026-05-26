# @reaatech/a2a-reference-persistence

Task store abstractions for A2A task persistence.

## Stores

### InMemoryTaskStore
Fast, ephemeral storage for development and testing:
```ts
const store = new InMemoryTaskStore();
```

### FileSystemTaskStore
JSON file-based persistence with periodic flush:
```ts
const store = new FileSystemTaskStore({ path: './data/tasks.json' });
await store.load();
```

### RedisTaskStore
Production-grade storage with Redis:
```ts
const store = new RedisTaskStore({ redis: new Redis() });
```

### PostgresTaskStore
Relational storage for audit-heavy deployments:
```ts
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const store = new PostgresTaskStore({ pool });
await store.initialize();
```

PostgresTaskStore auto-creates the following tables:
- `a2a_tasks` — Task metadata and status
- `a2a_history` — Message history (cascading delete)
- `a2a_artifacts` — Artifact storage with ordering

## Common Interface

All stores implement `TaskStore`:

```ts
interface TaskStore {
  create(task: Task): Promise<void>;
  get(id: string, options?: { historyLength?: number }): Promise<Task | undefined>;
  update(id: string, updates: Partial<Task> | ((t: Task) => Task)): Promise<Task | undefined>;
  list(options?: { contextId?, status?, pageSize?, pageToken?, historyLength? }): Promise<...>;
  cancel(id: string): Promise<Task | undefined>;
  addHistory(id: string, message: Message): Promise<void>;
  addArtifact(id: string, artifact: Artifact): Promise<void>;
  updateStatus(id: string, status: TaskStatus): Promise<void>;
}
```
