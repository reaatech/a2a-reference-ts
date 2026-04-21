import type { Artifact, Message, Task, TaskStatus } from '@a2a-ref/core';
import type { Redis } from 'ioredis';
import { applyHistoryLength, getTaskHistoryLength } from './shared.js';
import type { TaskStore } from './store.js';

export interface RedisTaskStoreOptions {
  redis: Redis;
  keyPrefix?: string;
}

export class RedisTaskStore implements TaskStore {
  private redis: Redis;
  private keyPrefix: string;
  private taskIndexKey: string;

  constructor(options: RedisTaskStoreOptions) {
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'a2a';
    this.taskIndexKey = `${this.keyPrefix}:tasks`;
  }

  private taskKey(id: string): string {
    return `${this.keyPrefix}:task:${id}`;
  }

  async create(task: Task): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.set(this.taskKey(task.id), JSON.stringify(task));
    pipeline.sadd(this.taskIndexKey, task.id);
    await pipeline.exec();
  }

  async get(id: string, options?: { historyLength?: number }): Promise<Task | undefined> {
    const data = await this.redis.get(this.taskKey(id));
    if (!data) return undefined;
    const task = JSON.parse(data) as Task;
    return applyHistoryLength(task, options?.historyLength);
  }

  async update(
    id: string,
    updates: Partial<Task> | ((task: Task) => Task),
  ): Promise<Task | undefined> {
    const data = await this.redis.get(this.taskKey(id));
    if (!data) return undefined;
    const task = JSON.parse(data) as Task;
    const updated = typeof updates === 'function' ? updates(task) : { ...task, ...updates };
    await this.redis.set(this.taskKey(id), JSON.stringify(updated));
    return updated;
  }

  async list(options?: {
    contextId?: string;
    status?: string;
    pageSize?: number;
    pageToken?: string;
    historyLength?: number;
  }): Promise<{ tasks: Task[]; nextPageToken: string; totalSize: number }> {
    const ids = await this.redis.smembers(this.taskIndexKey);
    if (ids.length === 0) {
      return { tasks: [], nextPageToken: '', totalSize: 0 };
    }

    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.taskKey(id));
    }
    const results = await pipeline.exec();

    let tasks: Task[] = [];
    for (const result of results ?? []) {
      const [, data] = result;
      if (typeof data === 'string') {
        tasks.push(JSON.parse(data) as Task);
      }
    }

    if (options?.contextId) {
      tasks = tasks.filter((t) => t.contextId === options.contextId);
    }
    if (options?.status) {
      tasks = tasks.filter((t) => t.status.state === options.status);
    }

    tasks.sort((a, b) => {
      const aTime = a.status.timestamp ?? '';
      const bTime = b.status.timestamp ?? '';
      return bTime.localeCompare(aTime);
    });

    const totalSize = tasks.length;
    const pageSize = options?.pageSize ?? 50;
    const pageToken = options?.pageToken ? Number.parseInt(options.pageToken, 10) : 0;
    const start = pageToken * pageSize;
    const paginated = tasks.slice(start, start + pageSize);
    const nextPageToken = start + pageSize < tasks.length ? String(pageToken + 1) : '';

    const historyLength = options?.historyLength;
    return {
      tasks: paginated.map((t) => applyHistoryLength(t, historyLength)),
      nextPageToken,
      totalSize,
    };
  }

  async cancel(id: string): Promise<Task | undefined> {
    const data = await this.redis.get(this.taskKey(id));
    if (!data) return undefined;
    const task = JSON.parse(data) as Task;
    const terminalStates = ['completed', 'failed', 'canceled', 'rejected'];
    if (terminalStates.includes(task.status.state)) {
      return undefined;
    }
    const updated: Task = {
      ...task,
      status: { ...task.status, state: 'canceled', timestamp: new Date().toISOString() },
    };
    await this.redis.set(this.taskKey(id), JSON.stringify(updated));
    return updated;
  }

  async addHistory(id: string, message: Message): Promise<void> {
    const data = await this.redis.get(this.taskKey(id));
    if (!data) return;
    const task = JSON.parse(data) as Task;
    let history = task.history ? [...task.history, message] : [message];
    const hl = getTaskHistoryLength(task);
    if (hl !== undefined && hl >= 0) {
      history = history.slice(-hl);
    }
    await this.redis.set(this.taskKey(id), JSON.stringify({ ...task, history }));
  }

  async addArtifact(id: string, artifact: Artifact): Promise<void> {
    const data = await this.redis.get(this.taskKey(id));
    if (!data) return;
    const task = JSON.parse(data) as Task;
    const artifacts = task.artifacts ? [...task.artifacts, artifact] : [artifact];
    await this.redis.set(this.taskKey(id), JSON.stringify({ ...task, artifacts }));
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    const data = await this.redis.get(this.taskKey(id));
    if (!data) return;
    const task = JSON.parse(data) as Task;
    await this.redis.set(this.taskKey(id), JSON.stringify({ ...task, status }));
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
