import { createA2AExpressApp } from '@reaatech/a2a-reference-server';
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from '@reaatech/a2a-reference-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A2AClient } from './client.js';

const testAgentCard = {
  name: 'Test Agent',
  description: 'A test agent',
  url: 'http://localhost:3456',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'test', name: 'Test', description: 'Test skill', tags: [] }],
  supportedInterfaces: [
    {
      url: 'http://localhost:3456',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

const testExecutor: AgentExecutor = {
  async execute(_ctx: ExecutionContext, bus: ExecutionEventBus) {
    bus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
    bus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: { parts: [{ kind: 'text', text: 'Done' }] },
    });
    bus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
  },
};

const app = createA2AExpressApp({ agentCard: testAgentCard, executor: testExecutor });
let server: ReturnType<typeof app.listen>;
let client: A2AClient;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(3456, () => resolve());
  });
  client = new A2AClient({ baseUrl: 'http://localhost:3456' });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('A2AClient', () => {
  it('discovers agent card', async () => {
    const card = await client.getAgentCard();
    expect(card.name).toBe('Test Agent');
  });

  it('sends a message and gets a task', async () => {
    const task = await client.sendMessage({
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'Hello' }],
    });
    expect(task.id).toBeDefined();
    expect(task.status.state).toMatch(/submitted|working|completed/);
  });

  it('gets a task by id', async () => {
    const sent = await client.sendMessage({
      messageId: 'msg-2',
      role: 'user',
      parts: [{ kind: 'text', text: 'Hello' }],
    });
    const task = await client.getTask(sent.id);
    expect(task.id).toBe(sent.id);
  });

  it('lists tasks', async () => {
    const result = await client.listTasks();
    expect(Array.isArray(result.tasks)).toBe(true);
  });
});
