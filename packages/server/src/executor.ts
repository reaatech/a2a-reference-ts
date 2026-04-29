import type { Message, Task, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from '@reaatech/a2a-reference-core';

export interface ExecutionContext {
  task: Task;
  message: Message;
}

export interface ExecutionEventBus {
  emitStatusUpdate(event: TaskStatusUpdateEvent): void;
  emitArtifactUpdate(event: TaskArtifactUpdateEvent): void;
}

export interface AgentExecutor {
  execute(context: ExecutionContext, eventBus: ExecutionEventBus): Promise<void>;
  cancelTask?(taskId: string, eventBus: ExecutionEventBus): Promise<void>;
}
