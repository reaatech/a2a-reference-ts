import { A2AClient } from '@a2a-ref/client';
import { createA2AExpressApp } from '@a2a-ref/server';
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from '@a2a-ref/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const agentCard = {
  name: 'E2E Hello Agent',
  description: 'Echoes back messages',
  url: 'http://localhost:9876',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'echo', name: 'Echo', description: 'Echoes text', tags: [] }],
  supportedInterfaces: [
    {
      url: 'http://localhost:9876',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

const executor: AgentExecutor = {
  async execute(context: ExecutionContext, bus: ExecutionEventBus) {
    const text = context.message.parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join(' ');
    bus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
    bus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: { parts: [{ kind: 'text', text: `Echo: ${text}` }] },
    });
    bus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
  },
};

const app = createA2AExpressApp({ agentCard, executor });
let server: ReturnType<typeof app.listen>;
let client: A2AClient;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(9876, () => resolve());
  });
  client = new A2AClient({ baseUrl: 'http://localhost:9876' });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('E2E hello-agent', () => {
  it('discovers agent card', async () => {
    const card = await client.getAgentCard();
    expect(card.name).toBe('E2E Hello Agent');
  });

  it('sends a message and completes a task', async () => {
    const task = await client.sendMessage({
      messageId: 'e2e-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'Hello A2A' }],
    });
    expect(task.id).toBeDefined();

    // Poll for completion
    let final = task;
    for (let i = 0; i < 20; i++) {
      if (final.status.state === 'completed' || final.status.state === 'failed') break;
      await new Promise((r) => setTimeout(r, 100));
      final = await client.getTask(task.id);
    }

    expect(final.status.state).toBe('completed');
    const text = final.artifacts?.[0]?.parts
      .filter((p) => p.kind === 'text')
      .map((p) => (p as { text: string }).text)
      .join(' ');
    expect(text).toBe('Echo: Hello A2A');
  });

  it('lists tasks', async () => {
    const result = await client.listTasks();
    expect(result.tasks.length).toBeGreaterThan(0);
  });
});
