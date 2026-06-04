import { TaskNotFoundError } from '@reaatech/a2a-reference-core';
import { createA2AExpressApp } from '@reaatech/a2a-reference-server';
import type {
  AgentExecutor,
  ExecutionContext,
  ExecutionEventBus,
} from '@reaatech/a2a-reference-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A2AClient } from './client.js';

const testAgentCard = {
  name: 'Test Agent',
  description: 'A test agent',
  url: 'http://localhost:3457',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'test', name: 'Test', description: 'Test skill', tags: [] }],
  supportedInterfaces: [
    {
      url: 'http://localhost:3457',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

const slowExecutor: AgentExecutor = {
  async execute(_ctx: ExecutionContext, bus: ExecutionEventBus) {
    bus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
    await new Promise((r) => setTimeout(r, 500));
    bus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: { parts: [{ kind: 'text', text: 'Done' }] },
    });
    bus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
  },
};

const app = createA2AExpressApp({ agentCard: testAgentCard, executor: slowExecutor });
let server: ReturnType<typeof app.listen>;
let client: A2AClient;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(3457, () => resolve());
  });
  client = new A2AClient({ baseUrl: 'http://localhost:3457' });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('A2AClient edge cases', () => {
  it('cancelTask cancels a running task', async () => {
    // Use sendSubscribe so the task is still running when we cancel
    const gen = client.sendSubscribe({
      messageId: 'msg-cancel',
      role: 'user',
      parts: [{ kind: 'text', text: 'Hello' }],
    });
    const first = await gen.next();
    expect(first.value).toBeDefined();
    const taskId = (first.value as { kind: 'task'; task: { id: string } }).task.id;
    const canceled = await client.cancelTask(taskId);
    expect(canceled.status.state).toBe('canceled');
    // drain generator
    await gen.return?.(undefined);
  });

  it('getTask throws TaskNotFoundError for missing task', async () => {
    await expect(client.getTask('non-existent')).rejects.toThrow(TaskNotFoundError);
  });

  it('discovers from card URL', async () => {
    const discovered = await A2AClient.fromCardUrl('http://localhost:3457/.well-known/agent.json');
    expect(discovered).toBeDefined();
    const card = await discovered.getAgentCard();
    expect(card.name).toBe('Test Agent');
  });

  it('handles HTTP errors gracefully', async () => {
    const badClient = new A2AClient({ baseUrl: 'http://localhost:99999' });
    await expect(badClient.getAgentCard()).rejects.toThrow();
  });

  it('listTasks handles errors', async () => {
    const badClient = new A2AClient({ baseUrl: 'http://localhost:99999' });
    await expect(badClient.listTasks()).rejects.toThrow();
  });

  it('cancelTask handles errors', async () => {
    const badClient = new A2AClient({ baseUrl: 'http://localhost:99999' });
    await expect(badClient.cancelTask('task-1')).rejects.toThrow();
  });
});
