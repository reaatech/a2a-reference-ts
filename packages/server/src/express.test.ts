import { ApiKeyStrategy, NoneStrategy } from '@reaatech/a2a-reference-auth';
import { InMemoryTaskStore } from '@reaatech/a2a-reference-persistence';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from './executor.js';
import { createA2AExpressApp } from './express.js';
import { RateLimiter } from './rate-limiter.js';

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

  describe('health check endpoints', () => {
    it('GET /healthz returns 200 with ok status', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /readyz returns 200 when healthy', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app).get('/readyz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('health endpoint includes version and uptime', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app).get('/healthz');
      expect(res.body.version).toBe('1.0.0');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('rate limiting', () => {
    it('requests under limit succeed', async () => {
      const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 10 });
      const app = createA2AExpressApp({
        agentCard: testAgentCard,
        executor: echoExecutor,
        rateLimiter: limiter,
      });
      const res = await request(app).get('/.well-known/agent.json');
      expect(res.status).toBe(200);
    });

    it('requests over limit get 429', async () => {
      const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 1 });
      const app = createA2AExpressApp({
        agentCard: testAgentCard,
        executor: echoExecutor,
        rateLimiter: limiter,
      });
      await request(app).get('/.well-known/agent.json');
      const res = await request(app).get('/.well-known/agent.json');
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Too Many Requests');
    });

    it('X-RateLimit-Remaining header is present', async () => {
      const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 10 });
      const app = createA2AExpressApp({
        agentCard: testAgentCard,
        executor: echoExecutor,
        rateLimiter: limiter,
      });
      const res = await request(app).get('/.well-known/agent.json');
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(Number(res.headers['x-ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
    });
  });

  describe('extended agent card', () => {
    it('GET /.well-known/agent-card/extended returns extended card when configured', async () => {
      const app = createA2AExpressApp({
        agentCard: testAgentCard,
        executor: echoExecutor,
        extendedAgentCard: { description: 'extended info', customField: 'value' },
      });
      const res = await request(app).get('/.well-known/agent-card/extended');
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('extended info');
      expect(res.body.customField).toBe('value');
    });

    it('GET /.well-known/agent-card/extended returns 404 when not configured', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app).get('/.well-known/agent-card/extended');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Extended agent card not configured');
    });
  });

  describe('push notification RPCs', () => {
    const pushAgentCard = {
      ...testAgentCard,
      name: 'Push Agent',
      capabilities: { ...testAgentCard.capabilities, pushNotifications: true },
    };

    it('tasks/pushNotification/set registers config', async () => {
      const app = createA2AExpressApp({ agentCard: pushAgentCard, executor: echoExecutor });
      const res = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-1', taskId: 'task-1', url: 'https://example.com/callback' },
        });
      expect(res.status).toBe(200);
      expect(res.body.result.ok).toBe(true);
      expect(res.body.result.id).toBe('cfg-1');
    });

    it('tasks/pushNotification/get returns config', async () => {
      const app = createA2AExpressApp({ agentCard: pushAgentCard, executor: echoExecutor });
      await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-2', taskId: 'task-2', url: 'https://example.com/callback' },
        });
      const res = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/pushNotification/get',
          params: { taskId: 'task-2' },
        });
      expect(res.status).toBe(200);
      expect(res.body.result.taskId).toBe('task-2');
      expect(res.body.result.url).toBe('https://example.com/callback');
    });

    it('tasks/pushNotification/list returns configs', async () => {
      const app = createA2AExpressApp({ agentCard: pushAgentCard, executor: echoExecutor });
      await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-3', taskId: 'task-3', url: 'https://example.com/callback' },
        });
      const res = await request(app).post('/').send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/pushNotification/list',
        params: {},
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.result.configs)).toBe(true);
      expect(res.body.result.configs).toHaveLength(1);
    });

    it('tasks/pushNotification/delete removes config', async () => {
      const app = createA2AExpressApp({ agentCard: pushAgentCard, executor: echoExecutor });
      await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-4', taskId: 'task-4', url: 'https://example.com/callback' },
        });
      await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/pushNotification/delete',
          params: { taskId: 'task-4' },
        });
      const getRes = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'tasks/pushNotification/get',
          params: { taskId: 'task-4' },
        });
      expect(getRes.status).toBe(200);
      expect(getRes.body.error).toBeDefined();
      expect(getRes.body.error.message).toContain('not found');
    });
  });

  describe('SSE endpoint executor behavior', () => {
    it('handles executor failure in SSE endpoint', async () => {
      const throwingExecutor: AgentExecutor = {
        async execute() {
          throw new Error('SSE failed');
        },
      };
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: throwingExecutor });
      const res = await request(app)
        .post('/tasks/sendSubscribe')
        .send({
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
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
      const body = res.body as string;
      expect(body).toContain('"kind":"task"');
      expect(body).toContain('"state":"failed"');
      expect(body).toContain('"final":true');
    });

    it('auto-completes task when executor does not set final state in SSE', async () => {
      const noFinalStateExecutor: AgentExecutor = {
        async execute(_ctx: ExecutionContext, eventBus: ExecutionEventBus) {
          await eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
        },
      };
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: noFinalStateExecutor });
      const res = await request(app)
        .post('/tasks/sendSubscribe')
        .send({
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
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
      const body = res.body as string;
      expect(body).toContain('"state":"completed"');
      expect(body).toContain('"final":true');
    });
  });

  describe('tasks/send auto-complete transition', () => {
    it('transitions to completed when executor does not set final state', async () => {
      const noFinalStateExecutor: AgentExecutor = {
        async execute(_ctx: ExecutionContext, eventBus: ExecutionEventBus) {
          await eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
        },
      };
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: noFinalStateExecutor });

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
      expect(sendRes.body.result.status.state).toBe('submitted');

      await new Promise((r) => setTimeout(r, 100));

      const getRes = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/get',
          params: { id: sendRes.body.result.id },
        });
      expect(getRes.body.result.status.state).toBe('completed');
    });
  });

  describe('executor.cancelTask', () => {
    it('calls executor.cancelTask when available in tasks/cancel', async () => {
      let cancelCalled = false;
      const cancelableExecutor: AgentExecutor = {
        async execute(_ctx: ExecutionContext, _bus: ExecutionEventBus) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
        async cancelTask(_taskId: string, _bus: ExecutionEventBus) {
          cancelCalled = true;
        },
      };
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: cancelableExecutor });

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

      await new Promise((r) => setTimeout(r, 10));

      await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/cancel',
          params: { id: taskId },
        });
      expect(cancelCalled).toBe(true);
    });
  });

  describe('JSON-RPC tasks/sendSubscribe', () => {
    it('handles tasks/sendSubscribe via JSON-RPC', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/sendSubscribe',
          params: {
            message: {
              messageId: 'msg-1',
              role: 'user',
              parts: [{ kind: 'text', text: 'Hello' }],
            },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.result.id).toBeDefined();
      expect(res.body.result.status.state).toBe('submitted');
    });

    it('handles executor failure in tasks/sendSubscribe RPC', async () => {
      const throwingExecutor: AgentExecutor = {
        async execute() {
          throw new Error('RPC sendSubscribe failed');
        },
      };
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: throwingExecutor });
      const res = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/sendSubscribe',
          params: {
            message: {
              messageId: 'msg-1',
              role: 'user',
              parts: [{ kind: 'text', text: 'Hello' }],
            },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.result.id).toBeDefined();
      expect(res.body.result.status.state).toBe('submitted');
    });
  });

  describe('push notification not-supported', () => {
    it('tasks/pushNotification/set throws when not supported', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-1', taskId: 'task-1', url: 'https://example.com/callback' },
        });
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toContain('not supported');
    });

    it('tasks/pushNotification/get throws when not supported', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/get',
          params: { taskId: 'task-1' },
        });
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toContain('not supported');
    });

    it('tasks/pushNotification/list throws when not supported', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app).post('/').send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/pushNotification/list',
        params: {},
      });
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toContain('not supported');
    });

    it('tasks/pushNotification/delete throws when not supported', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/delete',
          params: { taskId: 'task-1' },
        });
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toContain('not supported');
    });
  });

  describe('JSON-RPC tasks/sendSubscribe auto-complete', () => {
    it('transitions to completed when executor does not set final state in RPC', async () => {
      const noFinalStateExecutor: AgentExecutor = {
        async execute(_ctx: ExecutionContext, eventBus: ExecutionEventBus) {
          await eventBus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
        },
      };
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: noFinalStateExecutor });

      const res = await request(app)
        .post('/')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/sendSubscribe',
          params: {
            message: {
              messageId: 'msg-1',
              role: 'user',
              parts: [{ kind: 'text', text: 'Hello' }],
            },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.result.id).toBeDefined();
      expect(res.body.result.status.state).toBe('submitted');
    });
  });

  describe('extended agent card RPC', () => {
    it('tasks/extendedAgentCard returns extended card when configured', async () => {
      const app = createA2AExpressApp({
        agentCard: testAgentCard,
        executor: echoExecutor,
        extendedAgentCard: { description: 'extended info' },
      });
      const res = await request(app).post('/').send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/extendedAgentCard',
        params: {},
      });
      expect(res.status).toBe(200);
      expect(res.body.result.description).toBe('extended info');
    });

    it('tasks/extendedAgentCard throws when not configured', async () => {
      const app = createA2AExpressApp({ agentCard: testAgentCard, executor: echoExecutor });
      const res = await request(app).post('/').send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/extendedAgentCard',
        params: {},
      });
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toContain('not configured');
    });
  });
});
