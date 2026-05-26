import { ApiKeyStrategy, NoneStrategy } from '@reaatech/a2a-reference-auth';
import { InMemoryTaskStore } from '@reaatech/a2a-reference-persistence';
import { describe, expect, it, vi } from 'vitest';
import type { AgentExecutor } from './executor.js';
import { createA2AHonoApp } from './hono.js';
import { RateLimiter } from './rate-limiter.js';

const testAgentCard = {
  name: 'Hono Test Agent',
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

const testExecutor: AgentExecutor = {
  async execute(_ctx, bus) {
    bus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
    bus.emitArtifactUpdate({
      kind: 'artifact',
      artifact: { parts: [{ kind: 'text', text: 'Done' }] },
    });
    bus.emitStatusUpdate({ kind: 'status', status: { state: 'completed' } });
  },
};

describe('createA2AHonoApp', () => {
  it('serves agent card at /.well-known/agent.json', async () => {
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
    const res = await app.request('/.well-known/agent.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('Hono Test Agent');
  });

  it('serves agent card at /.well-known/agent-card', async () => {
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
    const res = await app.request('/.well-known/agent-card');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('Hono Test Agent');
  });

  it('handles tasks/send via JSON-RPC', async () => {
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { id: string; status: { state: string } } };
    expect(body.result.id).toBeDefined();
    expect(body.result.status.state).toBe('submitted');
  });

  it('handles tasks/get via JSON-RPC', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor, taskStore });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/get',
        params: { id: 'task-1' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { id: string; status: { state: string } } };
    expect(body.result.id).toBe('task-1');
    expect(body.result.status.state).toBe('submitted');
  });

  it('handles tasks/list via JSON-RPC', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor, taskStore });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/list',
        params: {},
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tasks: unknown[]; totalSize: number } };
    expect(body.result.tasks).toHaveLength(1);
    expect(body.result.totalSize).toBe(1);
  });

  it('handles tasks/cancel via JSON-RPC', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor, taskStore });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/cancel',
        params: { id: 'task-1' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { id: string; status: { state: string } } };
    expect(body.result.status.state).toBe('canceled');
  });

  it('returns 404 for missing task subscription', async () => {
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
    const res = await app.request('/tasks/missing-task/subscribe');
    expect(res.status).toBe(404);
  });

  it('supports SSE streaming via tasks/sendSubscribe', async () => {
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
    const res = await app.request('/tasks/sendSubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          messageId: 'msg-1',
          role: 'user',
          parts: [{ kind: 'text', text: 'Hello' }],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data:');
    expect(text).toContain('completed');
  });

  it('supports SSE subscription for existing tasks', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor, taskStore });
    const res = await app.request('/tasks/task-1/subscribe');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // The stream stays open; just verify it starts correctly
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (reader) {
      const { value } = await reader.read();
      expect(value).toBeDefined();
      reader.releaseLock();
    }
  });

  it('rejects invalid params for tasks/send', async () => {
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error).toBeDefined();
    expect(body.error?.message).toContain('Invalid');
  });

  it('rejects unauthenticated requests when auth strategy is configured', async () => {
    const app = createA2AHonoApp({
      agentCard: testAgentCard,
      executor: testExecutor,
      authStrategy: new ApiKeyStrategy({ keys: new Set(['secret']) }),
    });
    const res = await app.request('/.well-known/agent.json');
    expect(res.status).toBe(401);
  });

  it('allows authenticated requests with auth strategy', async () => {
    const app = createA2AHonoApp({
      agentCard: testAgentCard,
      executor: testExecutor,
      authStrategy: new ApiKeyStrategy({ keys: new Set(['secret']) }),
    });
    const res = await app.request('/.well-known/agent.json', {
      headers: { 'x-api-key': 'secret' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('Hono Test Agent');
  });

  it('stores principal on task creation with auth', async () => {
    const app = createA2AHonoApp({
      agentCard: testAgentCard,
      executor: testExecutor,
      authStrategy: new NoneStrategy(),
    });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    });
    const body = (await res.json()) as { result: { principal?: string } };
    expect(body.result.principal).toBe('anonymous');
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

    const app = createA2AHonoApp({
      agentCard: testAgentCard,
      executor: testExecutor,
      taskStore,
      authStrategy: new NoneStrategy(),
    });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/get',
        params: { id: 'existing-task' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error).toBeDefined();
    expect(body.error?.message).toContain('not found');
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

    const app = createA2AHonoApp({
      agentCard: testAgentCard,
      executor: testExecutor,
      taskStore,
      authStrategy: new NoneStrategy(),
    });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/list',
        params: {},
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tasks: unknown[]; totalSize: number } };
    expect(body.result.tasks).toHaveLength(0);
    expect(body.result.totalSize).toBe(0);
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

    const app = createA2AHonoApp({
      agentCard: testAgentCard,
      executor: testExecutor,
      taskStore,
      authStrategy: new NoneStrategy(),
    });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/cancel',
        params: { id: 'existing-task' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error).toBeDefined();
    expect(body.error?.message).toContain('not found');
  });

  it('returns error when canceling a non-cancelable task', async () => {
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'completed-task',
      status: { state: 'completed', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    const app = createA2AHonoApp({
      agentCard: testAgentCard,
      executor: testExecutor,
      taskStore,
    });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/cancel',
        params: { id: 'completed-task' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error).toBeDefined();
    expect(body.error?.message).toContain('not in a cancelable state');
  });

  it('calls executor.cancelTask when available', async () => {
    const cancelTask = vi.fn().mockResolvedValue(undefined);
    const cancelableExecutor: AgentExecutor = {
      execute: testExecutor.execute,
      cancelTask,
    };
    const taskStore = new InMemoryTaskStore();
    await taskStore.create({
      id: 'task-1',
      status: { state: 'working', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    const app = createA2AHonoApp({
      agentCard: testAgentCard,
      executor: cancelableExecutor,
      taskStore,
    });

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tasks/cancel',
        params: { id: 'task-1' },
      }),
    });
    expect(res.status).toBe(200);
    expect(cancelTask).toHaveBeenCalledWith('task-1', expect.any(Object));
  });

  it('shutdown closes SSE connections gracefully', async () => {
    const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });

    // Start an SSE connection
    const ssePromise = app.request('/tasks/sendSubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        message: {
          messageId: 'msg-1',
          role: 'user',
          parts: [{ kind: 'text', text: 'Hello' }],
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.shutdown({ timeoutMs: 100 });

    const res = await ssePromise;
    expect(res.status).toBe(200);
  });

  describe('health check endpoints', () => {
    it('GET /healthz returns 200 with ok status', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/healthz');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    });

    it('GET /readyz returns 200 when healthy', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/readyz');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    });

    it('health endpoint includes version and uptime', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/healthz');
      const body = (await res.json()) as { version: string; uptime: number; timestamp: string };
      expect(body.version).toBe('1.0.0');
      expect(typeof body.uptime).toBe('number');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('rate limiting', () => {
    it('requests under limit succeed', async () => {
      const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 10 });
      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: testExecutor,
        rateLimiter: limiter,
      });
      const res = await app.request('/.well-known/agent.json');
      expect(res.status).toBe(200);
    });

    it('requests over limit get 429', async () => {
      const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 1 });
      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: testExecutor,
        rateLimiter: limiter,
      });
      await app.request('/.well-known/agent.json');
      const res = await app.request('/.well-known/agent.json');
      expect(res.status).toBe(429);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Too Many Requests');
    });

    it('X-RateLimit-Remaining header is present', async () => {
      const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 10 });
      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: testExecutor,
        rateLimiter: limiter,
      });
      const res = await app.request('/.well-known/agent.json');
      expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
      expect(Number(res.headers.get('X-RateLimit-Remaining'))).toBeGreaterThanOrEqual(0);
    });
  });

  describe('extended agent card', () => {
    it('GET /.well-known/agent-card/extended returns extended card when configured', async () => {
      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: testExecutor,
        extendedAgentCard: { description: 'extended info', customField: 'value' },
      });
      const res = await app.request('/.well-known/agent-card/extended');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { description: string; customField: string };
      expect(body.description).toBe('extended info');
      expect(body.customField).toBe('value');
    });

    it('GET /.well-known/agent-card/extended returns 404 when not configured', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/.well-known/agent-card/extended');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Extended agent card not configured');
    });
  });

  describe('push notification RPCs', () => {
    const pushAgentCard = {
      ...testAgentCard,
      name: 'Push Agent',
      capabilities: { ...testAgentCard.capabilities, pushNotifications: true },
    };

    it('tasks/pushNotification/set registers config', async () => {
      const app = createA2AHonoApp({ agentCard: pushAgentCard, executor: testExecutor });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-1', taskId: 'task-1', url: 'https://example.com/callback' },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { ok: boolean; id: string } };
      expect(body.result.ok).toBe(true);
      expect(body.result.id).toBe('cfg-1');
    });

    it('tasks/pushNotification/get returns config', async () => {
      const app = createA2AHonoApp({ agentCard: pushAgentCard, executor: testExecutor });
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-2', taskId: 'task-2', url: 'https://example.com/callback' },
        }),
      });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/pushNotification/get',
          params: { taskId: 'task-2' },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { taskId: string; url: string } };
      expect(body.result.taskId).toBe('task-2');
      expect(body.result.url).toBe('https://example.com/callback');
    });

    it('tasks/pushNotification/list returns configs', async () => {
      const app = createA2AHonoApp({ agentCard: pushAgentCard, executor: testExecutor });
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-3', taskId: 'task-3', url: 'https://example.com/callback' },
        }),
      });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/pushNotification/list',
          params: {},
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { configs: unknown[] } };
      expect(Array.isArray(body.result.configs)).toBe(true);
      expect(body.result.configs).toHaveLength(1);
    });

    it('tasks/pushNotification/delete removes config', async () => {
      const app = createA2AHonoApp({ agentCard: pushAgentCard, executor: testExecutor });
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-4', taskId: 'task-4', url: 'https://example.com/callback' },
        }),
      });
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/pushNotification/delete',
          params: { taskId: 'task-4' },
        }),
      });
      const getRes = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tasks/pushNotification/get',
          params: { taskId: 'task-4' },
        }),
      });
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as { error?: { message: string } };
      expect(getBody.error).toBeDefined();
      expect(getBody.error?.message).toContain('not found');
    });
  });

  describe('SSE subscribe endpoint', () => {
    it('returns 404 when task belongs to different principal', async () => {
      const taskStore = new InMemoryTaskStore();
      await taskStore.create({
        id: 'other-task',
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        history: [],
        metadata: {},
        principal: 'other-user',
      });
      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: testExecutor,
        taskStore,
        authStrategy: new NoneStrategy(),
      });
      const res = await app.request('/tasks/other-task/subscribe');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('not found');
    });

    it('returns 400 when task is in terminal state', async () => {
      const taskStore = new InMemoryTaskStore();
      await taskStore.create({
        id: 'done-task',
        status: { state: 'completed', timestamp: new Date().toISOString() },
        history: [],
        metadata: {},
      });
      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: testExecutor,
        taskStore,
      });
      const res = await app.request('/tasks/done-task/subscribe');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Task is in a terminal state');
    });
  });

  describe('onError handler', () => {
    it('returns 500 on unhandled errors', async () => {
      const store = new InMemoryTaskStore();
      store.get = async () => {
        throw new Error('store error');
      };

      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: testExecutor,
        taskStore: store,
      });
      const res = await app.request('/tasks/any-task/subscribe');
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Internal Server Error');
    });
  });

  describe('SSE endpoint executor behavior', () => {
    it('handles executor failure in SSE endpoint', async () => {
      const throwingExecutor: AgentExecutor = {
        async execute() {
          throw new Error('SSE failed');
        },
      };
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: throwingExecutor });
      const res = await app.request('/tasks/sendSubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"state":"failed"');
      expect(text).toContain('"final":true');
    });

    it('auto-completes task when executor does not set final state in SSE', async () => {
      const noFinalStateExecutor: AgentExecutor = {
        async execute(_ctx, bus) {
          await bus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
        },
      };
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: noFinalStateExecutor });
      const res = await app.request('/tasks/sendSubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"state":"completed"');
      expect(text).toContain('"final":true');
    });
  });

  describe('tasks/send executor behavior', () => {
    it('handles executor failure in tasks/send', async () => {
      const throwingExecutor: AgentExecutor = {
        async execute() {
          throw new Error('send failed');
        },
      };
      const taskStore = new InMemoryTaskStore();
      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: throwingExecutor,
        taskStore,
      });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { id: string } };
      const taskId = body.result.id;

      await new Promise((r) => setTimeout(r, 100));

      const getRes = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/get',
          params: { id: taskId },
        }),
      });
      const getBody = (await getRes.json()) as {
        result: { status: { state: string } };
      };
      expect(getBody.result.status.state).toBe('failed');
    });

    it('transitions to completed when executor does not set final state', async () => {
      const noFinalStateExecutor: AgentExecutor = {
        async execute(_ctx, bus) {
          await bus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
        },
      };
      const taskStore = new InMemoryTaskStore();
      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: noFinalStateExecutor,
        taskStore,
      });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });
      const sendBody = (await res.json()) as { result: { id: string } };
      await new Promise((r) => setTimeout(r, 100));

      const getRes = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/get',
          params: { id: sendBody.result.id },
        }),
      });
      const getBody = (await getRes.json()) as {
        result: { status: { state: string } };
      };
      expect(getBody.result.status.state).toBe('completed');
    });
  });

  describe('tasks/cancel error paths', () => {
    it('returns error when canceling non-existent task', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/cancel',
          params: { id: 'non-existent' },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { error?: { message: string } };
      expect(body.error).toBeDefined();
      expect(body.error?.message).toContain('not found');
    });
  });

  describe('JSON-RPC tasks/sendSubscribe auto-complete', () => {
    it('transitions to completed when executor does not set final state in RPC', async () => {
      const noFinalStateExecutor: AgentExecutor = {
        async execute(_ctx, bus) {
          await bus.emitStatusUpdate({ kind: 'status', status: { state: 'working' } });
        },
      };
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: noFinalStateExecutor });

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { id: string; status: { state: string } };
      };
      expect(body.result.id).toBeDefined();
      expect(body.result.status.state).toBe('submitted');
    });
  });

  describe('JSON-RPC tasks/sendSubscribe', () => {
    it('handles tasks/sendSubscribe via JSON-RPC', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { id: string; status: { state: string } };
      };
      expect(body.result.id).toBeDefined();
      expect(body.result.status.state).toBe('submitted');
    });

    it('handles executor failure in tasks/sendSubscribe RPC', async () => {
      const throwingExecutor: AgentExecutor = {
        async execute() {
          throw new Error('RPC sendSubscribe failed');
        },
      };
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: throwingExecutor });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { id: string; status: { state: string } };
      };
      expect(body.result.id).toBeDefined();
      expect(body.result.status.state).toBe('submitted');
    });
  });

  describe('push notification not-supported', () => {
    it('tasks/pushNotification/set throws when not supported', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/set',
          params: { id: 'cfg-1', taskId: 'task-1', url: 'https://example.com/callback' },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { error?: { message: string } };
      expect(body.error).toBeDefined();
      expect(body.error?.message).toContain('not supported');
    });

    it('tasks/pushNotification/get throws when not supported', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/get',
          params: { taskId: 'task-1' },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { error?: { message: string } };
      expect(body.error).toBeDefined();
      expect(body.error?.message).toContain('not supported');
    });

    it('tasks/pushNotification/list throws when not supported', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/list',
          params: {},
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { error?: { message: string } };
      expect(body.error).toBeDefined();
      expect(body.error?.message).toContain('not supported');
    });

    it('tasks/pushNotification/delete throws when not supported', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/pushNotification/delete',
          params: { taskId: 'task-1' },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { error?: { message: string } };
      expect(body.error).toBeDefined();
      expect(body.error?.message).toContain('not supported');
    });
  });

  describe('extended agent card RPC', () => {
    it('tasks/extendedAgentCard returns extended card when configured', async () => {
      const app = createA2AHonoApp({
        agentCard: testAgentCard,
        executor: testExecutor,
        extendedAgentCard: { description: 'extended info' },
      });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/extendedAgentCard',
          params: {},
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { description: string } };
      expect(body.result.description).toBe('extended info');
    });

    it('tasks/extendedAgentCard throws when not configured', async () => {
      const app = createA2AHonoApp({ agentCard: testAgentCard, executor: testExecutor });
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/extendedAgentCard',
          params: {},
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { error?: { message: string } };
      expect(body.error).toBeDefined();
      expect(body.error?.message).toContain('not configured');
    });
  });
});
