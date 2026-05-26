import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { clearInterval } from 'node:timers';
import type { Artifact, Message, Task, TaskStatus } from '@reaatech/a2a-reference-core';
import { applyHistoryLength, getTaskHistoryLength } from './shared.js';
import type { TaskStore } from './store.js';

export interface FileSystemTaskStoreOptions {
  path: string;
}

export class FileSystemTaskStore implements TaskStore {
  private tasks = new Map<string, Task>();
  private filePath: string;
  private dirty = false;
  private flushInterval: ReturnType<typeof setInterval>;
  private flushing: Promise<void> | null = null;

  constructor(options: FileSystemTaskStoreOptions) {
    this.filePath = options.path;
    this.flushInterval = setInterval(() => {
      this.flush().catch(() => {
        /* ignore interval flush errors */
      });
    }, 5000);
    // Initial load is async; consumers should await load() after construction
  }

  async load(): Promise<void> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as Task[];
      this.tasks = new Map(parsed.map((t) => [t.id, t]));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.flushInterval);
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      if (!this.dirty) return;
    }
    if (!this.dirty) return;

    this.flushing = (async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const data = JSON.stringify(Array.from(this.tasks.values()), null, 2);
      await writeFile(this.filePath, data, 'utf-8');
      this.dirty = false;
    })();

    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  private markDirty(): void {
    this.dirty = true;
  }

  async create(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
    this.markDirty();
    await this.flush();
  }

  async get(id: string, options?: { historyLength?: number }): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    return applyHistoryLength(task, options?.historyLength);
  }

  async update(
    id: string,
    updates: Partial<Task> | ((task: Task) => Task),
  ): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const updated = typeof updates === 'function' ? updates(task) : { ...task, ...updates };
    this.tasks.set(id, updated);
    this.markDirty();
    await this.flush();
    return updated;
  }

  async list(options?: {
    contextId?: string;
    status?: string;
    principal?: string;
    pageSize?: number;
    pageToken?: string;
    historyLength?: number;
  }): Promise<{ tasks: Task[]; nextPageToken: string; totalSize: number }> {
    let tasks = Array.from(this.tasks.values());
    if (options?.contextId) {
      tasks = tasks.filter((t) => t.contextId === options.contextId);
    }
    if (options?.status) {
      tasks = tasks.filter((t) => t.status.state === options.status);
    }
    if (options?.principal) {
      tasks = tasks.filter((t) => t.principal === options.principal);
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
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const terminalStates = ['completed', 'failed', 'canceled', 'rejected'];
    if (terminalStates.includes(task.status.state)) {
      return undefined;
    }
    const updated: Task = {
      ...task,
      status: { ...task.status, state: 'canceled', timestamp: new Date().toISOString() },
    };
    this.tasks.set(id, updated);
    this.markDirty();
    await this.flush();
    return updated;
  }

  async addHistory(id: string, message: Message): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;
    let history = task.history ? [...task.history, message] : [message];
    const hl = getTaskHistoryLength(task);
    if (hl !== undefined && hl >= 0) {
      history = history.slice(-hl);
    }
    this.tasks.set(id, { ...task, history });
    this.markDirty();
    await this.flush();
  }

  async addArtifact(id: string, artifact: Artifact): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;
    const artifacts = task.artifacts ? [...task.artifacts, artifact] : [artifact];
    this.tasks.set(id, { ...task, artifacts });
    this.markDirty();
    await this.flush();
  }

  async updateStatus(id: string, status: TaskStatus): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;
    this.tasks.set(id, { ...task, status });
    this.markDirty();
    await this.flush();
  }
}
