import type { AuthResult } from '@reaatech/a2a-reference-auth';

import { defaultLogger } from '@reaatech/a2a-reference-observability';
import type { TaskStore } from '@reaatech/a2a-reference-persistence';
import type { ExecutionEventBus } from './executor.js';
import type { PushNotificationManager } from './push-notifications.js';

export const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  submitted: [
    'working',
    'input-required',
    'completed',
    'failed',
    'canceled',
    'rejected',
    'auth-required',
  ],
  working: ['input-required', 'completed', 'failed', 'canceled', 'auth-required'],
  'input-required': ['working', 'completed', 'failed', 'canceled', 'auth-required'],
  'auth-required': ['working', 'completed', 'failed', 'canceled'],
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
  pushNotificationManager?: PushNotificationManager,
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
      if (pushNotificationManager) {
        // Fire-and-forget: webhook delivery (with retries) must not block execution.
        void pushNotificationManager
          .notifyStatusUpdate(task, event)
          .catch((err) => defaultLogger.error({ err, taskId }, 'push status notification failed'));
      }
    },
    emitArtifactUpdate: async (event) => {
      await taskStore.addArtifact(taskId, event.artifact);
      broadcast(taskId, { kind: 'artifact', artifact: event.artifact });
      if (pushNotificationManager) {
        const task = await taskStore.get(taskId);
        if (task) {
          void pushNotificationManager
            .notifyArtifactUpdate(task, event)
            .catch((err) =>
              defaultLogger.error({ err, taskId }, 'push artifact notification failed'),
            );
        }
      }
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
