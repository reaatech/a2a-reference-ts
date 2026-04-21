import { describe, expect, it } from 'vitest';
import { TaskArtifactUpdateEventSchema, TaskStatusUpdateEventSchema } from './events.js';

describe('Event schemas', () => {
  it('validates status update event', () => {
    const result = TaskStatusUpdateEventSchema.safeParse({
      kind: 'status',
      taskId: 'task-1',
      contextId: 'ctx-1',
      status: { state: 'working' },
      final: true,
    });
    expect(result.success).toBe(true);
  });

  it('validates artifact update event', () => {
    const result = TaskArtifactUpdateEventSchema.safeParse({
      kind: 'artifact',
      taskId: 'task-1',
      contextId: 'ctx-1',
      artifact: {
        artifactId: 'art-1',
        name: 'result',
        parts: [{ kind: 'text', text: 'hello' }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid event kind', () => {
    const result = TaskStatusUpdateEventSchema.safeParse({
      kind: 'unknown',
      taskId: 'task-1',
      contextId: 'ctx-1',
      status: { state: 'working' },
    });
    expect(result.success).toBe(false);
  });
});
