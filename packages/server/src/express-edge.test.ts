import { NoneStrategy } from '@reaatech/a2a-reference-auth';
import { InMemoryTaskStore } from '@reaatech/a2a-reference-persistence';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AgentExecutor } from './executor.js';
import { createA2AExpressApp } from './express.js';

const testAgentCard = {
  name: 'Test Agent',
  description: 'Test',
  url: 'http://localhost:3000',
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
      url: 'http://localhost:3000',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

const failingExecutor: AgentExecutor = {
  async execute() {
    throw new Error('execution failed');
  },
};

describe('createA2AExpressApp edge cases', () => {
  it('returns error for non-existent task in tasks/get', async () => {
    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: failingExecutor,
    });
    const res = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/get',
        params: { id: 'non-existent' },
      });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toContain('not found');
  });

  it('returns error when canceling non-existent task', async () => {
    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: failingExecutor,
    });
    const res = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/cancel',
        params: { id: 'non-existent' },
      });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toContain('not found');
  });

  it('returns error when canceling already-completed task', async () => {
    const executor: AgentExecutor = {
      async execute(_ctx, bus) {
        bus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
        bus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
      },
    };
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor });

    const sendRes = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/send',
        params: {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
      });

    // Wait for task to complete
    await new Promise((r) => setTimeout(r, 100));

    const cancelRes = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/cancel',
        params: { id: sendRes.body.result.id },
      });
    expect(cancelRes.body.error).toBeDefined();
    expect(cancelRes.body.error.message).toContain('not in a cancelable state');
  });

  it('handles executor failure gracefully', async () => {
    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: failingExecutor,
    });
    const res = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/send',
        params: {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.status.state).toBe('submitted');

    // Wait for async failure
    await new Promise((r) => setTimeout(r, 100));
    const getRes = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/get',
        params: { id: res.body.result.id },
      });
    expect(getRes.body.result.status.state).toBe('failed');
  });

  it('supports tasks/list with filters', async () => {
    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: failingExecutor,
    });

    await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/send',
        params: {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
          contextId: 'ctx-1',
        },
      });

    const listRes = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/list',
        params: { contextId: 'ctx-1' },
      });
    expect(listRes.body.result.tasks).toHaveLength(1);
  });

  it('returns 404 for subscribe to non-existent task', async () => {
    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: failingExecutor,
    });
    const res = await request(app).get('/tasks/missing-task/subscribe');
    expect(res.status).toBe(404);
  });

  it('returns 400 for subscribe to terminal task', async () => {
    const executor: AgentExecutor = {
      async execute(_ctx, bus) {
        bus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
      },
    };
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor });

    const sendRes = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/send',
        params: {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
      });

    await new Promise((r) => setTimeout(r, 100));

    const subRes = await request(app).get(`/tasks/${sendRes.body.result.id}/subscribe`);
    expect(subRes.status).toBe(400);
  });

  it('returns typed error for tasks/get with Zod invalid params', async () => {
    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: failingExecutor,
    });
    const res = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/get',
        params: { id: 12345 },
      });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toContain('Expected string');
  });

  it('returns 404 for subscribe when task belongs to different principal', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'priv-task',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
      principal: 'other-user',
    });

    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: failingExecutor,
      taskStore,
      authStrategy: new NoneStrategy(),
    });

    const res = await request(app).get('/tasks/priv-task/subscribe');
    expect(res.status).toBe(404);
  });

  it('works without auth strategy (no principal filtering)', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'shared-task',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: failingExecutor,
      taskStore,
    });

    const res = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/get',
        params: { id: 'shared-task' },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.id).toBe('shared-task');
  });
});
