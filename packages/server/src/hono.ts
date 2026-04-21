import type { AuthResult, AuthStrategy } from '@a2a-ref/auth';
import type { AgentCard, Task } from '@a2a-ref/core';
import {
  CancelTaskRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
  SendMessageRequestSchema,
  TaskNotCancelableError,
  TaskNotFoundError,
} from '@a2a-ref/core';
import { InMemoryTaskStore, type TaskStore } from '@a2a-ref/persistence';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AgentExecutor } from './executor.js';
import { JsonRpcRouter } from './json-rpc.js';
import { createEventBus, enforcePrincipal, filterByPrincipal, generateTaskId } from './shared.js';

export interface A2AHonoOptions {
  agentCard: AgentCard;
  executor: AgentExecutor;
  taskStore?: TaskStore;
  authStrategy?: AuthStrategy;
}

export interface A2AHonoShutdownOptions {
  timeoutMs?: number;
}

type Variables = {
  auth?: AuthResult;
};

function getHeaders(record: Headers): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};
  record.forEach((value, key) => {
    const existing = headers[key];
    if (existing === undefined) {
      headers[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      headers[key] = [existing, value];
    }
  });
  return headers;
}

export function createA2AHonoApp(
  options: A2AHonoOptions,
): Hono<{ Variables: Variables }> & { shutdown: (opts?: A2AHonoShutdownOptions) => Promise<void> } {
  const { agentCard, executor } = options;
  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const rpc = new JsonRpcRouter<AuthResult | undefined>();
  const sseConnections = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();

  async function shutdownSse(): Promise<void> {
    for (const [taskId, connections] of sseConnections) {
      for (const controller of connections) {
        try {
          controller.close();
        } catch {
          /* ignore close errors */
        }
      }
      sseConnections.delete(taskId);
    }
  }

  function broadcastToTask(taskId: string, data: unknown): void {
    const connections = sseConnections.get(taskId);
    if (!connections) return;
    const payload = new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
    for (const controller of connections) {
      controller.enqueue(payload);
    }
  }

  const app = new Hono<{ Variables: Variables }>();

  // Authentication middleware
  const authStrategy = options.authStrategy;
  if (authStrategy) {
    app.use(async (c, next) => {
      const result = await authStrategy.authenticate({
        headers: getHeaders(c.req.raw.headers),
      });
      if (!result.authenticated) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      c.set('auth', result);
      return next();
    });
  }

  // Agent Card discovery
  app.get('/.well-known/agent.json', (c: Context) => {
    return c.json(agentCard);
  });

  app.get('/.well-known/agent-card', (c: Context) => {
    return c.json(agentCard);
  });

  // JSON-RPC endpoint
  app.post('/', async (c: Context) => {
    const body = await c.req.json();
    const auth = c.get('auth');
    const response = await rpc.handle(body, auth);
    return c.json(response);
  });

  // SSE streaming endpoint for tasks/sendSubscribe
  app.post('/tasks/sendSubscribe', async (c: Context) => {
    const params = await c.req.json();
    const validated = SendMessageRequestSchema.parse(params);
    const message = validated.message;
    const taskId = validated.taskId || generateTaskId();
    const auth = c.get('auth');

    const task: Task = {
      id: taskId,
      contextId: validated.contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [message],
      metadata: {},
      principal: auth?.principal,
    };
    await taskStore.create(task);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const connections = sseConnections.get(taskId) ?? new Set();
        connections.add(controller);
        sseConnections.set(taskId, connections);

        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'task', task })}\n\n`),
        );

        (async () => {
          await taskStore.updateStatus(taskId, {
            state: 'working',
            timestamp: new Date().toISOString(),
          });
          broadcastToTask(taskId, { kind: 'status', status: { state: 'working' } });

          try {
            await executor.execute(
              { task, message },
              createEventBus(taskId, taskStore, broadcastToTask),
            );
            const finalTask = await taskStore.get(taskId);
            if (finalTask && finalTask.status.state === 'working') {
              await taskStore.updateStatus(taskId, {
                state: 'completed',
                timestamp: new Date().toISOString(),
              });
              broadcastToTask(taskId, {
                kind: 'status',
                status: { state: 'completed' },
                final: true,
              });
            }
          } catch {
            await taskStore.updateStatus(taskId, {
              state: 'failed',
              timestamp: new Date().toISOString(),
            });
            broadcastToTask(taskId, {
              kind: 'status',
              status: { state: 'failed' },
              final: true,
            });
          } finally {
            setTimeout(() => {
              controller.close();
              connections.delete(controller);
              if (connections.size === 0) sseConnections.delete(taskId);
            }, 500);
          }
        })();
      },
      cancel(controller) {
        const connections = sseConnections.get(taskId);
        if (connections) {
          connections.delete(controller);
          if (connections.size === 0) {
            sseConnections.delete(taskId);
          }
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  // SSE subscription endpoint for existing tasks
  app.get('/tasks/:taskId/subscribe', async (c: Context) => {
    const taskId = c.req.param('taskId');
    if (!taskId) {
      return c.json({ error: 'Task ID is required' }, 400);
    }
    const task = await taskStore.get(taskId);
    if (!task) {
      return c.json({ error: `Task not found: ${taskId}` }, 404);
    }

    const auth = c.get('auth');
    if (enforcePrincipal(task, auth) === undefined) {
      return c.json({ error: `Task not found: ${taskId}` }, 404);
    }

    const terminalStates = ['completed', 'failed', 'canceled', 'rejected'];
    if (terminalStates.includes(task.status.state)) {
      return c.json({ error: 'Task is in a terminal state' }, 400);
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const connections = sseConnections.get(taskId) ?? new Set();
        connections.add(controller);
        sseConnections.set(taskId, connections);

        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'task', task })}\n\n`),
        );

        c.req.raw.signal.addEventListener('abort', () => {
          connections.delete(controller);
          if (connections.size === 0) sseConnections.delete(taskId);
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  // tasks/send (sync/non-blocking)
  rpc.register('tasks/send', async (params, auth) => {
    const validated = SendMessageRequestSchema.parse(params);
    const message = validated.message;
    const taskId = validated.taskId || generateTaskId();

    const task: Task = {
      id: taskId,
      contextId: validated.contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [message],
      metadata: {},
      principal: auth?.principal,
    };
    await taskStore.create(task);

    await taskStore.updateStatus(taskId, { state: 'working', timestamp: new Date().toISOString() });

    (async () => {
      try {
        await executor.execute(
          { task, message },
          createEventBus(taskId, taskStore, broadcastToTask),
        );
        const finalTask = await taskStore.get(taskId);
        if (finalTask && finalTask.status.state === 'working') {
          await taskStore.updateStatus(taskId, {
            state: 'completed',
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        await taskStore.updateStatus(taskId, {
          state: 'failed',
          timestamp: new Date().toISOString(),
        });
      }
    })();

    return task;
  });

  // tasks/get
  rpc.register('tasks/get', async (params, auth) => {
    const validated = GetTaskRequestSchema.parse(params);
    const task = await taskStore.get(validated.id);
    if (!task) {
      throw new TaskNotFoundError(validated.id);
    }
    if (enforcePrincipal(task, auth) === undefined) {
      throw new TaskNotFoundError(validated.id);
    }
    return task;
  });

  // tasks/list
  rpc.register('tasks/list', async (params, auth) => {
    const validated = ListTasksRequestSchema.parse(params);
    const result = await taskStore.list({
      contextId: validated.contextId,
      status: validated.status,
      pageSize: validated.pageSize,
      pageToken: validated.pageToken,
    });
    const filtered = filterByPrincipal(result.tasks, auth);
    return {
      tasks: filtered,
      nextPageToken: result.nextPageToken,
      totalSize: filtered.length,
    };
  });

  // tasks/cancel
  rpc.register('tasks/cancel', async (params, auth) => {
    const validated = CancelTaskRequestSchema.parse(params);
    const task = await taskStore.get(validated.id);
    if (!task) {
      throw new TaskNotFoundError(validated.id);
    }
    if (enforcePrincipal(task, auth) === undefined) {
      throw new TaskNotFoundError(validated.id);
    }
    const cancelableStates = ['submitted', 'working', 'input-required', 'auth-required'];
    if (!cancelableStates.includes(task.status.state)) {
      throw new TaskNotCancelableError(task.id);
    }

    if (executor.cancelTask) {
      await executor.cancelTask(task.id, createEventBus(task.id, taskStore, broadcastToTask));
    }

    const updated = await taskStore.cancel(task.id);
    broadcastToTask(task.id, {
      kind: 'status',
      status: { state: 'canceled' },
      final: true,
    });
    return updated;
  });

  const shutdown = async (opts?: A2AHonoShutdownOptions) => {
    const timeoutMs = opts?.timeoutMs ?? 10_000;
    const deadline = Date.now() + timeoutMs;
    await shutdownSse();
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(remaining, 1000)));
    }
  };

  return Object.assign(app, { shutdown });
}
