import { beforeEach, describe, expect, it } from 'vitest';
import { RedisTaskStore } from './redis.js';

// Minimal mock of ioredis Redis interface
function createMockRedis() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  return {
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    get: async (key: string) => {
      return store.get(key) ?? null;
    },
    sadd: async (key: string, ...members: string[]) => {
      const set = sets.get(key) ?? new Set<string>();
      let added = 0;
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member);
          added++;
        }
      }
      sets.set(key, set);
      return added;
    },
    smembers: async (key: string) => {
      const set = sets.get(key);
      return set ? Array.from(set) : [];
    },
    pipeline: () => {
      const cmds: Array<() => Promise<unknown>> = [];
      const redisHelpers = {
        set: async (k: string, v: string) => store.set(k, v),
        get: async (k: string) => store.get(k) ?? null,
        sadd: async (k: string, ...m: string[]) => {
          const set = sets.get(k) ?? new Set<string>();
          let added = 0;
          for (const member of m) {
            if (!set.has(member)) {
              set.add(member);
              added++;
            }
          }
          sets.set(k, set);
          return added;
        },
      };
      const self: {
        set: (key: string, value: string) => typeof self;
        get: (key: string) => typeof self;
        sadd: (key: string, ...members: string[]) => typeof self;
        exec: () => Promise<[Error | null, unknown][]>;
      } = {
        set: (key: string, value: string) => {
          cmds.push(async () => redisHelpers.set(key, value));
          return self;
        },
        get: (key: string) => {
          cmds.push(async () => redisHelpers.get(key));
          return self;
        },
        sadd: (key: string, ...members: string[]) => {
          cmds.push(async () => redisHelpers.sadd(key, ...members));
          return self;
        },
        exec: async () => {
          const results: [Error | null, unknown][] = [];
          for (const cmd of cmds) {
            try {
              const value = await cmd();
              results.push([null, value]);
            } catch (err) {
              results.push([err instanceof Error ? err : new Error(String(err)), null]);
            }
          }
          return results;
        },
      };
      return self;
    },
    quit: async () => {
      /* no-op */
    },
  };
}

describe('RedisTaskStore', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let store: RedisTaskStore;

  beforeEach(() => {
    mockRedis = createMockRedis();
    store = new RedisTaskStore({ redis: mockRedis as unknown as import('ioredis').Redis });
  });

  it('creates and gets a task', async () => {
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
  });

  it('returns undefined for missing task', async () => {
    const result = await store.get('missing');
    expect(result).toBeUndefined();
  });

  it('updates a task', async () => {
    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    const updated = await store.update('task-1', {
      status: { state: 'working', timestamp: new Date().toISOString() },
    });
    expect(updated?.status.state).toBe('working');
    const retrieved = await store.get('task-1');
    expect(retrieved?.status.state).toBe('working');
  });

  it('supports functional update', async () => {
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
  });

  it('returns undefined when updating missing task', async () => {
    const updated = await store.update('missing', {
      status: { state: 'completed', timestamp: new Date().toISOString() },
    });
    expect(updated).toBeUndefined();
  });

  it('lists tasks with pagination', async () => {
    for (let i = 1; i <= 5; i++) {
      await store.create({
        id: `task-${i}`,
        status: { state: 'submitted', timestamp: new Date(2024, 0, i).toISOString() },
        history: [],
        metadata: {},
      });
    }
    const result = await store.list({ pageSize: 2 });
    expect(result.tasks).toHaveLength(2);
    expect(result.totalSize).toBe(5);
    expect(result.nextPageToken).toBe('1');
  });

  it('filters list by contextId', async () => {
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
  });

  it('filters list by status', async () => {
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
  });

  it('cancels a task', async () => {
    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    const canceled = await store.cancel('task-1');
    expect(canceled?.status.state).toBe('canceled');
  });

  it('returns undefined when canceling a terminal task', async () => {
    await store.create({
      id: 'task-1',
      status: { state: 'completed', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    const result = await store.cancel('task-1');
    expect(result).toBeUndefined();
  });

  it('adds history to a task', async () => {
    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
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

  it('adds artifact to a task', async () => {
    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    await store.addArtifact('task-1', {
      artifactId: 'art-1',
      name: 'result',
      parts: [{ kind: 'text', text: 'done' }],
    });
    const task = await store.get('task-1');
    expect(task?.artifacts).toHaveLength(1);
  });

  it('updates status', async () => {
    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    await store.updateStatus('task-1', { state: 'working', timestamp: new Date().toISOString() });
    const task = await store.get('task-1');
    expect(task?.status.state).toBe('working');
  });

  it('uses custom key prefix', async () => {
    const customStore = new RedisTaskStore({
      redis: mockRedis as unknown as import('ioredis').Redis,
      keyPrefix: 'custom',
    });
    await customStore.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
    });
    const retrieved = await customStore.get('task-1');
    expect(retrieved).toBeDefined();
  });

  it('returns empty list when no tasks exist', async () => {
    const result = await store.list();
    expect(result.tasks).toHaveLength(0);
    expect(result.totalSize).toBe(0);
  });

  it('truncates history on addHistory when task has historyLength', async () => {
    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      metadata: {},
      historyLength: 2,
    });
    await store.addHistory('task-1', {
      messageId: 'm1',
      role: 'user',
      parts: [{ kind: 'text', text: 'a' }],
    });
    await store.addHistory('task-1', {
      messageId: 'm2',
      role: 'agent',
      parts: [{ kind: 'text', text: 'b' }],
    });
    await store.addHistory('task-1', {
      messageId: 'm3',
      role: 'user',
      parts: [{ kind: 'text', text: 'c' }],
    });
    const task = await store.get('task-1');
    expect(task?.history).toHaveLength(2);
    expect(task?.history?.[0].messageId).toBe('m2');
  });

  it('returns truncated history via get with historyLength option', async () => {
    await store.create({
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [
        { messageId: 'm1', role: 'user', parts: [{ kind: 'text', text: 'a' }] },
        { messageId: 'm2', role: 'agent', parts: [{ kind: 'text', text: 'b' }] },
      ],
      metadata: {},
    });
    const truncated = await store.get('task-1', { historyLength: 1 });
    expect(truncated?.history).toHaveLength(1);
    expect(truncated?.history?.[0].messageId).toBe('m2');
  });
});
