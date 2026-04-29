import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '@reaatech/a2a-reference-core';
import { describe, expect, it } from 'vitest';
import { FileSystemTaskStore } from './file-system.js';

describe('FileSystemTaskStore', () => {
  it('creates, gets, and lists tasks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    const task = {
      id: 'task-1',
      status: { state: 'submitted' as const, timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    };
    await store.create(task);
    const retrieved = await store.get('task-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('task-1');

    const listResult = await store.list();
    expect(listResult.tasks).toHaveLength(1);
    expect(listResult.totalSize).toBe(1);

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('persists across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const path = join(dir, 'tasks.json');

    const store1 = new FileSystemTaskStore({ path });
    await store1.load();
    await store1.create({
      id: 'task-persist',
      status: { state: 'completed', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    await store1.close();

    const store2 = new FileSystemTaskStore({ path });
    await store2.load();
    const retrieved = await store2.get('task-persist');
    expect(retrieved).toBeDefined();
    expect(retrieved?.status.state).toBe('completed');
    await store2.close();

    await rm(dir, { recursive: true });
  });

  it('truncates history on addHistory when task has historyLength', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
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

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('returns truncated history via get and list with historyLength option', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [
        { messageId: 'msg-1', role: 'user', parts: [{ kind: 'text', text: 'a' }] },
        { messageId: 'msg-2', role: 'agent', parts: [{ kind: 'text', text: 'b' }] },
      ],
      metadata: {},
    });

    const truncated = await store.get('task-1', { historyLength: 1 });
    expect(truncated?.history).toHaveLength(1);
    expect(truncated?.history?.[0].messageId).toBe('msg-2');

    const listResult = await store.list({ historyLength: 1 });
    expect(listResult.tasks[0].history).toHaveLength(1);

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('paginates list results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    for (let i = 1; i <= 5; i++) {
      await store.create({
        id: `task-${i}`,
        status: { state: 'submitted', timestamp: new Date(2024, 0, i).toISOString() },
        history: [],
        metadata: {},
      });
    }

    const page1 = await store.list({ pageSize: 2 });
    expect(page1.tasks).toHaveLength(2);
    expect(page1.totalSize).toBe(5);
    expect(page1.nextPageToken).toBe('1');

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('preserves principal and tenantId on create and update', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
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

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('cancels a task', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    const canceled = await store.cancel('task-1');
    expect(canceled?.status.state).toBe('canceled');
    expect(canceled?.status.timestamp).toBeDefined();

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('returns undefined when canceling a terminal task', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-1',
      status: { state: 'completed', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    const result = await store.cancel('task-1');
    expect(result).toBeUndefined();

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('adds an artifact to a task', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    await store.addArtifact('task-1', {
      artifactId: 'art-1',
      name: 'result',
      parts: [{ kind: 'text', text: 'hello' }],
    });

    const task = await store.get('task-1');
    expect(task?.artifacts).toHaveLength(1);
    expect(task?.artifacts?.[0].name).toBe('result');

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('updates task status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    await store.updateStatus('task-1', { state: 'working', timestamp: new Date().toISOString() });
    const task = await store.get('task-1');
    expect(task?.status.state).toBe('working');

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('filters list by contextId', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-a',
      contextId: 'ctx-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    await store.create({
      id: 'task-b',
      contextId: 'ctx-2',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    const result = await store.list({ contextId: 'ctx-1' });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('task-a');

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('filters list by status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-a',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    await store.create({
      id: 'task-b',
      status: { state: 'completed', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    const result = await store.list({ status: 'completed' });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('task-b');

    await store.close();
    await rm(dir, { recursive: true });
  });

  it('supports functional update', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a2a-persist-'));
    const store = new FileSystemTaskStore({ path: join(dir, 'tasks.json') });
    await store.load();

    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });

    const updated = await store.update('task-1', (task) => ({
      ...task,
      status: { ...task.status, state: 'working' },
    }));
    expect(updated?.status.state).toBe('working');

    await store.close();
    await rm(dir, { recursive: true });
  });
});
