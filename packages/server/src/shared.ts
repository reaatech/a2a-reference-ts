import type { AuthResult } from '@a2a-ref/auth';

import type { TaskStore } from '@a2a-ref/persistence';
import type { ExecutionEventBus } from './executor.js';

export const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  submitted: ['working', 'input-required', 'completed', 'failed', 'canceled', 'rejected'],
  working: ['input-required', 'completed', 'failed', 'canceled'],
  'input-required': ['working', 'completed', 'failed', 'canceled'],
  completed: [],
  failed: [],
  canceled: [],
  rejected: [],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export type BroadcastFn = (taskId: string, data: unknown) => void;

export function createEventBus(
  taskId: string,
  taskStore: TaskStore,
  broadcast: BroadcastFn,
): ExecutionEventBus {
  return {
    emitStatusUpdate: async (event) => {
      const task = await taskStore.get(taskId);
      if (!task) return;
      const currentState = task.status.state;
      const newState = event.status.state;
      if (currentState !== newState && !canTransition(currentState, newState)) {
        // Task may have been canceled or moved to terminal state externally; ignore silently
        return;
      }
      await taskStore.updateStatus(taskId, event.status);
      broadcast(taskId, { kind: 'status', status: event.status, final: event.final });
    },
    emitArtifactUpdate: async (event) => {
      await taskStore.addArtifact(taskId, event.artifact);
      broadcast(taskId, { kind: 'artifact', artifact: event.artifact });
    },
  };
}

export function enforcePrincipal<T extends { principal?: string }>(
  item: T | undefined,
  auth: AuthResult | undefined,
): T | undefined {
  if (!item) return undefined;
  if (auth?.principal && item.principal !== auth.principal) {
    return undefined;
  }
  return item;
}

export function filterByPrincipal<T extends { principal?: string }>(
  items: T[],
  auth: AuthResult | undefined,
): T[] {
  if (!auth?.principal) return items;
  return items.filter((item) => item.principal === auth.principal);
}
