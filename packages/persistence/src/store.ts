import type { Artifact, Message, Task, TaskStatus } from '@reaatech/a2a-reference-core';

export interface TaskStore {
  create(task: Task): Promise<void>;
  get(id: string, options?: { historyLength?: number }): Promise<Task | undefined>;
  update(id: string, updates: Partial<Task> | ((task: Task) => Task)): Promise<Task | undefined>;
  list(options?: {
    contextId?: string;
    status?: string;
    pageSize?: number;
    pageToken?: string;
    historyLength?: number;
  }): Promise<{ tasks: Task[]; nextPageToken: string; totalSize: number }>;
  cancel(id: string): Promise<Task | undefined>;
  addHistory(id: string, message: Message): Promise<void>;
  addArtifact(id: string, artifact: Artifact): Promise<void>;
  updateStatus(id: string, status: TaskStatus): Promise<void>;
}
