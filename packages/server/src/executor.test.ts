import type { Message, Task } from '@reaatech/a2a-reference-core';
import { describe, expect, it, vi } from 'vitest';
import type { AgentExecutor, ExecutionContext, ExecutionEventBus } from './executor.js';

describe('AgentExecutor interface', () => {
  it('supports a mock executor that implements the contract', async () => {
    const emitStatusUpdate = vi.fn().mockResolvedValue(undefined);
    const emitArtifactUpdate = vi.fn().mockResolvedValue(undefined);

    const eventBus: ExecutionEventBus = {
      emitStatusUpdate,
      emitArtifactUpdate,
    };

    const task: Task = {
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
    };

    const message: Message = {
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'Hello' }],
    };

    const context: ExecutionContext = { task, message };

    const executor: AgentExecutor = {
      async execute(_ctx, bus) {
        await bus.emitStatusUpdate({
          kind: 'status',
          status: { state: 'working' },
        });
        await bus.emitArtifactUpdate({
          kind: 'artifact',
          artifact: { parts: [{ kind: 'text', text: 'result' }] },
        });
        await bus.emitStatusUpdate({
          kind: 'status',
          status: { state: 'completed' },
          final: true,
        });
      },
    };

    await executor.execute(context, eventBus);

    expect(emitStatusUpdate).toHaveBeenCalledTimes(2);
    expect(emitStatusUpdate).toHaveBeenNthCalledWith(1, {
      kind: 'status',
      status: { state: 'working' },
    });
    expect(emitStatusUpdate).toHaveBeenNthCalledWith(2, {
      kind: 'status',
      status: { state: 'completed' },
      final: true,
    });
    expect(emitArtifactUpdate).toHaveBeenCalledTimes(1);
    expect(emitArtifactUpdate).toHaveBeenCalledWith({
      kind: 'artifact',
      artifact: { parts: [{ kind: 'text', text: 'result' }] },
    });
  });

  it('supports cancelTask as an optional method', async () => {
    const emitStatusUpdate = vi.fn().mockResolvedValue(undefined);
    const emitArtifactUpdate = vi.fn().mockResolvedValue(undefined);
    const eventBus: ExecutionEventBus = { emitStatusUpdate, emitArtifactUpdate };

    const cancelTask = vi.fn().mockResolvedValue(undefined);

    const executor: AgentExecutor = {
      async execute(_ctx, _bus) {},
      cancelTask,
    };

    const task: Task = {
      id: 'task-1',
      status: { state: 'working', timestamp: new Date().toISOString() },
    };
    const message: Message = {
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'cancel' }],
    };

    await executor.execute({ task, message }, eventBus);
    await executor.cancelTask?.('task-1', eventBus);

    expect(cancelTask).toHaveBeenCalledWith('task-1', eventBus);
  });

  it('executes without cancelTask when not provided', () => {
    const executor: AgentExecutor = {
      async execute() {},
    };
    expect(executor.cancelTask).toBeUndefined();
  });

  it('provides full ExecutionContext shape', () => {
    const task: Task = {
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      artifacts: [{ parts: [{ kind: 'text', text: 'intermediate' }] }],
      history: [
        {
          messageId: 'msg-0',
          role: 'user',
          parts: [{ kind: 'text', text: 'prior' }],
        },
      ],
      metadata: { source: 'test' },
      principal: 'alice',
      tenantId: 'tenant-1',
    };

    const message: Message = {
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'Hello' }],
    };

    const context: ExecutionContext = { task, message };

    expect(context.task).toBe(task);
    expect(context.message).toBe(message);
    expect(context.task.artifacts).toHaveLength(1);
    expect(context.task.history).toHaveLength(1);
    expect(context.task.principal).toBe('alice');
  });

  it('emits events through ExecutionEventBus in expected order', async () => {
    const events: string[] = [];
    const eventBus: ExecutionEventBus = {
      async emitStatusUpdate(event) {
        events.push(`status:${event.status.state}`);
      },
      async emitArtifactUpdate(event) {
        events.push(`artifact:${event.artifact.parts[0].kind}`);
      },
    };

    const executor: AgentExecutor = {
      async execute(_ctx, bus) {
        await bus.emitStatusUpdate({
          kind: 'status',
          status: { state: 'working' },
        });
        await bus.emitArtifactUpdate({
          kind: 'artifact',
          artifact: { parts: [{ kind: 'text', text: 'progress' }] },
        });
        await bus.emitStatusUpdate({
          kind: 'status',
          status: { state: 'completed' },
          final: true,
        });
      },
    };

    const task: Task = {
      id: 'task-1',
      status: { state: 'submitted', timestamp: new Date().toISOString() },
    };
    const message: Message = {
      messageId: 'msg-1',
      role: 'user',
      parts: [{ kind: 'text', text: 'go' }],
    };

    await executor.execute({ task, message }, eventBus);

    expect(events).toEqual(['status:working', 'artifact:text', 'status:completed']);
  });
});
