import { ApiKeyStrategy, NoneStrategy } from '@reaatech/a2a-reference-auth';
import { InMemoryTaskStore } from '@reaatech/a2a-reference-persistence';
import { describe, expect, it, vi } from 'vitest';
import type { AgentExecutor } from './executor.js';
import { createA2AHonoApp } from './hono.js';

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
});
