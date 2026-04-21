import type { Task } from '@a2a-ref/core';
import { describe, expect, it } from 'vitest';
import { InMemoryTaskStore } from './in-memory.js';

describe('InMemoryTaskStore', () => {
  it('creates and retrieves a task', async () => {
    const store = new InMemoryTaskStore();
    const task = {
      id: 'task-1',
      status: { state: 'submitted' as const },
      history: [],
      metadata: {},
    };
    await store.create(task);
    const retrieved = await store.get('task-1');
    expect(retrieved).toEqual(task);
  });

  it('updates task status', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
    });
    await store.updateStatus('task-1', { state: 'working' });
    const task = await store.get('task-1');
    expect(task?.status.state).toBe('working');
  });

  it('adds artifacts', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
    });
    await store.addArtifact('task-1', {
      name: 'result',
      parts: [{ kind: 'text' as const, text: 'hello' }],
    });
    const task = await store.get('task-1');
    expect(task?.artifacts).toHaveLength(1);
  });

  it('cancels a task', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'working' },
      history: [],
      metadata: {},
    });
    const canceled = await store.cancel('task-1');
    expect(canceled?.status.state).toBe('canceled');
  });

  it('returns undefined for non-existent task', async () => {
    const store = new InMemoryTaskStore();
    const task = await store.get('missing');
    expect(task).toBeUndefined();
  });

  it('paginates list results', async () => {
    const store = new InMemoryTaskStore();
    for (let i = 1; i <= 5; i++) {
      await store.create({
        id: `task-${i}`,
        status: { state: 'submitted', timestamp: new Date(2024, 0, i).toISOString() },
        history: [],
        metadata: {},
      });
    }

    const page1 = await store.list({ pageSize: 2, pageToken: '0' });
    expect(page1.tasks).toHaveLength(2);
    expect(page1.totalSize).toBe(5);
    expect(page1.nextPageToken).toBe('1');

    const page2 = await store.list({ pageSize: 2, pageToken: page1.nextPageToken });
    expect(page2.tasks).toHaveLength(2);
    expect(page2.nextPageToken).toBe('2');

    const page3 = await store.list({ pageSize: 2, pageToken: page2.nextPageToken });
    expect(page3.tasks).toHaveLength(1);
    expect(page3.nextPageToken).toBe('');
  });

  it('truncates history on addHistory when task has historyLength', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
      historyLength: 2,
    } as Task);

    await store.addHistory('task-1', {
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'a' }],
    });
    await store.addHistory('task-1', {
      messageId: 'msg-2',
      role: 'agent',
      parts: [{ kind: 'text', text: 'b' }],
    });
    await store.addHistory('task-1', {
      messageId: 'msg-3',
      role: 'user',
      parts: [{ kind: 'text', text: 'c' }],
    });

    const task = await store.get('task-1');
    expect(task?.history).toHaveLength(2);
    expect(task?.history?.[0].messageId).toBe('msg-2');
    expect(task?.history?.[1].messageId).toBe('msg-3');
  });

  it('returns truncated history via get with historyLength option', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted' },
      history: [
        { messageId: 'msg-1', role: 'user', parts: [{ kind: 'text', text: 'a' }] },
        { messageId: 'msg-2', role: 'agent', parts: [{ kind: 'text', text: 'b' }] },
        { messageId: 'msg-3', role: 'user', parts: [{ kind: 'text', text: 'c' }] },
      ],
      metadata: {},
    });

    const full = await store.get('task-1');
    expect(full?.history).toHaveLength(3);

    const truncated = await store.get('task-1', { historyLength: 1 });
    expect(truncated?.history).toHaveLength(1);
    expect(truncated?.history?.[0].messageId).toBe('msg-3');
  });

  it('returns truncated history via list with historyLength option', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [
        { messageId: 'msg-1', role: 'user', parts: [{ kind: 'text', text: 'a' }] },
        { messageId: 'msg-2', role: 'agent', parts: [{ kind: 'text', text: 'b' }] },
      ],
      metadata: {},
    });

    const result = await store.list({ historyLength: 1 });
    expect(result.tasks[0].history).toHaveLength(1);
    expect(result.tasks[0].history?.[0].messageId).toBe('msg-2');
  });

  it('preserves principal and tenantId on create and update', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
      principal: 'user-123',
      tenantId: 'tenant-456',
    });

    const task = await store.get('task-1');
    expect(task?.principal).toBe('user-123');
    expect(task?.tenantId).toBe('tenant-456');

    await store.update('task-1', { tenantId: 'tenant-789' });
    const updated = await store.get('task-1');
    expect(updated?.principal).toBe('user-123');
    expect(updated?.tenantId).toBe('tenant-789');
  });
});
