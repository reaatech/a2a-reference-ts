import { describe, expect, it } from 'vitest';
import { InMemoryTaskStore } from './in-memory.js';

describe('InMemoryTaskStore edge cases', () => {
  it('update with function', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
    });
    const updated = await store.update('task-1', (task) => ({
      ...task,
      status: { state: 'working' },
    }));
    expect(updated?.status.state).toBe('working');
  });

  it('update returns undefined for missing task', async () => {
    const store = new InMemoryTaskStore();
    const updated = await store.update('missing', { status: { state: 'completed' } });
    expect(updated).toBeUndefined();
  });

  it('list with status filter', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
    });
    await store.create({
      id: 'task-2',
      status: { state: 'completed' },
      history: [],
      metadata: {},
    });
    const result = await store.list({ status: 'completed' });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('task-2');
  });

  it('list with contextId filter', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      contextId: 'ctx-1',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
    });
    await store.create({
      id: 'task-2',
      contextId: 'ctx-2',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
    });
    const result = await store.list({ contextId: 'ctx-1' });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('task-1');
  });

  it('addHistory appends messages', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
    });
    await store.addHistory('task-1', {
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'hello' }],
    });
    const task = await store.get('task-1');
    expect(task?.history).toHaveLength(1);
  });

  it('addHistory does nothing for missing task', async () => {
    const store = new InMemoryTaskStore();
    await expect(
      store.addHistory('missing', {
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'hello' }],
      }),
    ).resolves.toBeUndefined();
  });

  it('addArtifact appends artifacts', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'submitted' },
      history: [],
      metadata: {},
    });
    await store.addArtifact('task-1', {
      name: 'result',
      parts: [{ kind: 'text', text: 'done' }],
    });
    const task = await store.get('task-1');
    expect(task?.artifacts).toHaveLength(1);
  });

  it('updateStatus updates status', async () => {
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

  it('cancel returns undefined for already terminal task', async () => {
    const store = new InMemoryTaskStore();
    await store.create({
      id: 'task-1',
      status: { state: 'completed' },
      history: [],
      metadata: {},
    });
    const canceled = await store.cancel('task-1');
    expect(canceled).toBeUndefined();
  });
});
