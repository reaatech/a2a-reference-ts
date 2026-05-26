# @reaatech/a2a-reference-client

Type-safe A2A client SDK for task submission, discovery, and SSE streaming.

## Usage

```ts
import { A2AClient } from '@reaatech/a2a-reference-client';

const client = new A2AClient({ baseUrl: 'http://localhost:3000' });
```

## Methods

### Discovery
```ts
const card = await client.getAgentCard();
// Or discover from a DID
const card = await A2AClient.fromCardUrl('http://example.com/.well-known/agent.json');
```

### Task Management
```ts
// Create a task (sync)
const task = await client.sendMessage({
  messageId: crypto.randomUUID(),
  role: 'user',
  parts: [{ kind: 'text', text: 'Hello!' }],
});

// Get task status
const task = await client.getTask('task-123');

// List tasks
const result = await client.listTasks({ pageSize: 10 });

// Cancel a task
const task = await client.cancelTask('task-123');
```

### SSE Streaming
```ts
// Create and stream
for await (const event of client.sendSubscribe({
  messageId: crypto.randomUUID(),
  role: 'user',
  parts: [{ kind: 'text', text: 'Stream this' }],
})) {
  if (event.kind === 'artifact') {
    console.log('Artifact:', event.artifact.parts);
  }
  if (event.kind === 'status' && event.final) {
    console.log('Done:', event.status.state);
  }
}

// Subscribe to existing task
for await (const event of client.subscribe('task-123')) {
  // handle events
}
```

## Options

```ts
const client = new A2AClient({
  baseUrl: 'http://localhost:3000',
  agentCardTtlMs: 300_000,    // Cache agent card for 5 minutes
  maxRetries: 3,               // Retry on failure
  retryDelayMs: 200,           // Base delay for exponential backoff
});
```
