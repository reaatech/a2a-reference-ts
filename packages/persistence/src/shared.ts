import type { Task } from '@a2a-ref/core';

export function applyHistoryLength(task: Task, historyLength?: number): Task {
  if (historyLength === undefined || historyLength < 0) return task;
  if (!task.history || task.history.length <= historyLength) return task;
  return {
    ...task,
    history: task.history.slice(-historyLength),
  };
}

export function getTaskHistoryLength(task: Task): number | undefined {
  return task.historyLength;
}
