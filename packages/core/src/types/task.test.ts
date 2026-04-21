import { describe, expect, it } from 'vitest';
import { TaskSchema, TaskStateSchema } from './task.js';

describe('TaskSchema', () => {
  it('validates a minimal task', () => {
    const result = TaskSchema.safeParse({
      id: 'task-123',
      status: {
        state: 'submitted',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid task state', () => {
    const result = TaskStateSchema.safeParse('unknown-state');
    expect(result.success).toBe(false);
  });

  it('accepts all valid task states', () => {
    const states = [
      'submitted',
      'working',
      'input-required',
      'completed',
      'failed',
      'canceled',
      'rejected',
      'auth-required',
    ] as const;
    for (const state of states) {
      expect(TaskStateSchema.safeParse(state).success).toBe(true);
    }
  });
});
