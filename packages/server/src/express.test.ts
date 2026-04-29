import { ApiKeyStrategy, NoneStrategy } from '@reaatech/a2a-reference-auth';
import { InMemoryTaskStore } from '@reaatech/a2a-reference-persistence';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from './executor.js';
import { createA2AExpressApp } from './express.js';

const testAgentCard = {
  name: 'Echo Agent',
  description: 'Echoes back your message',
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
  skills: [
    {
      id: 'echo',
      name: 'Echo',
      description: 'Echo a message back',
      tags: ['echo'],
    },
  ],
  supportedInterfaces: [
    {
      url: 'http://localhost:3000',
      protocolBinding: 'a2a',
      protocolVersion: '0.3.0',
    },
  ],
};

const echoExecutor: AgentExecutor = {
  async execute(context: ExecutionContext, eventBus: ExecutionEventBus) {
    const text = context.message.parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join(' ');
    await eventBus.emitStatusUpdate({
      kind: 'status',
      status: { state: 'working' },
    });
    await eventBus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: {
        name: 'echo',
        parts: [{ kind: 'text', text: `Echo: ${text}` }],
      },
    });
    await eventBus.emitStatusUpdate({
      kind: 'status',
      status: { state: 'completed' },
    });
  },
};

describe('createA2AExpressApp', () => {
  it('serves agent card at /.well-known/agent.json', async () => {
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
    const res = await request(app).get('/.well-known/agent.json');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Echo Agent');
  });

  it('serves agent card at /.well-known/agent-card', async () => {
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
    const res = await request(app).get('/.well-known/agent-card');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Echo Agent');
  });

  it('handles tasks/send and returns a task', async () => {
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
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
    expect(res.body.result.status.state).toMatch(/submitted|working/);
    expect(res.body.result.id).toBeDefined();
  });

  it('handles tasks/get', async () => {
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });

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
    const taskId = sendRes.body.result.id;

    const getRes = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/get',
        params: { id: taskId },
      });
    expect(getRes.status).toBe(200);
    expect(getRes.body.result.id).toBe(taskId);
  });

  it('handles tasks/cancel', async () => {
    // Use a slow executor so we can cancel before completion
    const slowExecutor: AgentExecutor = {
      async execute(_ctx: ExecutionContext, _bus: ExecutionEventBus) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
    };
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor: slowExecutor });

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
    const taskId = sendRes.body.result.id;

    const cancelRes = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/cancel',
        params: { id: taskId },
      });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.result.status.state).toBe('canceled');
  });

  it('enforces valid state transitions', async () => {
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });

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
    const taskId = sendRes.body.result.id;

    // Cancel the task
    await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/cancel',
        params: { id: taskId },
      });

    // Try to cancel again - should fail
    const secondCancel = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tasks/cancel',
        params: { id: taskId },
      });
    expect(secondCancel.status).toBe(200);
    expect(secondCancel.body.error).toBeDefined();
    expect(secondCancel.body.error.message).toContain('not in a cancelable state');
  });

  it('supports SSE streaming via tasks/sendSubscribe', async () => {
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
    const res = await request(app)
      .post('/tasks/sendSubscribe')
      .send({
        message: {
          messageId: 'msg-1',
          role: 'user',
          parts: [{ kind: 'text', text: 'Hello SSE' }],
        },
      })
      .buffer(true)
      .parse((res, callback) => {
        res.setEncoding('utf8');
        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          callback(null, data);
        });
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(typeof res.body === 'string' && res.body.includes('"kind":"task"')).toBe(true);
    expect(typeof res.body === 'string' && res.body.includes('"kind":"artifact"')).toBe(true);
    expect(typeof res.body === 'string' && res.body.includes('Echo: Hello SSE')).toBe(true);
  });

  it('rejects invalid params for tasks/send', async () => {
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
    const res = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/send',
        params: {
          message: {
            messageId: 'msg-1',
            role: 'invalid-role',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toContain('Invalid');
  });

  it('rejects unauthenticated requests when auth strategy is configured', async () => {
    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: echoExecutor,
      authStrategy: new ApiKeyStrategy({ keys: new Set(['secret']) }),
    });
    const res = await request(app).get('/.well-known/agent.json');
    expect(res.status).toBe(401);
  });

  it('allows authenticated requests with auth strategy', async () => {
    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: echoExecutor,
      authStrategy: new ApiKeyStrategy({ keys: new Set(['secret']) }),
    });
    const res = await request(app).get('/.well-known/agent.json').set('x-api-key', 'secret');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Echo Agent');
  });

  it('stores principal on task creation with auth', async () => {
    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: echoExecutor,
      authStrategy: new NoneStrategy(),
    });
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
    expect(sendRes.body.result.principal).toBe('anonymous');
  });

  it('enforces task ownership in tasks/get', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'existing-task',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
      principal: 'other-user',
    });

    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: echoExecutor,
      taskStore,
      authStrategy: new NoneStrategy(),
    });

    const getRes = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/get',
        params: { id: 'existing-task' },
      });
    expect(getRes.status).toBe(200);
    expect(getRes.body.error).toBeDefined();
    expect(getRes.body.error.message).toContain('not found');
  });

  it('enforces task ownership in tasks/list', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
      principal: 'alice',
    });
    await taskStore.create({
      id: 'task-2',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
      principal: 'bob',
    });

    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: echoExecutor,
      taskStore,
      authStrategy: new NoneStrategy(),
    });

    const listRes = await request(app).post('/').send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tasks/list',
      params: {},
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body.result.tasks).toHaveLength(0);
    expect(listRes.body.result.totalSize).toBe(0);
  });

  it('enforces task ownership in tasks/cancel', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'existing-task',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
      principal: 'other-user',
    });

    const app = createA2AExpressApp({
      agentCard: testAgentCard,
      executor: echoExecutor,
      taskStore,
      authStrategy: new NoneStrategy(),
    });

    const cancelRes = await request(app)
      .post('/')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/cancel',
        params: { id: 'existing-task' },
      });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.error).toBeDefined();
    expect(cancelRes.body.error.message).toContain('not found');
  });

  it('shutdown closes SSE connections gracefully', async () => {
    const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });

    // Start an SSE connection
    const sseReq = request(app)
      .post('/tasks/sendSubscribe')
      .set('Accept', 'text/event-stream')
      .send({
        message: {
          messageId: 'msg-1',
          role: 'user',
          parts: [{ kind: 'text', text: 'Hello' }],
        },
      });

    // Give the SSE connection time to establish
    await new Promise((resolve) => setTimeout(resolve, 50));

    await app.shutdown({ timeoutMs: 100 });

    // The request should eventually complete (or error) after shutdown
    const res = await sseReq;
    expect(res.status).toBe(200);
  });
});
