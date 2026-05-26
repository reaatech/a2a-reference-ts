import type { AuthResult, AuthStrategy } from '@reaatech/a2a-reference-auth';
import type { AgentCard, Task } from '@reaatech/a2a-reference-core';
import {
  CancelTaskRequestSchema,
  ExtendedAgentCardNotConfiguredError,
  GetExtendedAgentCardRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
  PushNotificationNotSupportedError,
  SendMessageRequestSchema,
  TaskNotCancelableError,
  TaskNotFoundError,
  TaskPushNotificationConfigSchema,
} from '@reaatech/a2a-reference-core';
import { defaultLogger } from '@reaatech/a2a-reference-observability';
import { InMemoryTaskStore, type TaskStore } from '@reaatech/a2a-reference-persistence';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AgentExecutor } from './executor.js';
import { type HealthCheck, createHealthStatus } from './health.js';
import { JsonRpcRouter } from './json-rpc.js';
import { PushNotificationManager } from './push-notifications.js';
import type { RateLimiter } from './rate-limiter.js';
import { createEventBus, enforcePrincipal, filterByPrincipal, generateTaskId } from './shared.js';

export interface A2AHonoOptions {
  agentCard: AgentCard;
  executor: AgentExecutor;
  taskStore?: TaskStore;
  authStrategy?: AuthStrategy;
  rateLimiter?: RateLimiter;
  extendedAgentCard?: Record<string, unknown>;
  pushNotificationManager?: PushNotificationManager;
  healthChecks?: HealthCheck[];
  version?: string;
  /**
   * When `true`, derive the client IP for rate limiting from forwarding headers
   * (`X-Forwarded-For` / `CF-Connecting-IP` / `X-Real-IP`). Only enable this
   * behind a trusted proxy that overwrites the headers — otherwise clients can
   * spoof them to evade or poison rate limits. Defaults to `false`.
   */
  trustProxyHeaders?: boolean;
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

const startTime = Date.now();

export function createA2AHonoApp(
  options: A2AHonoOptions,
): Hono<{ Variables: Variables }> & { shutdown: (opts?: A2AHonoShutdownOptions) => Promise<void> } {
  const { agentCard, executor } = options;
  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const rpc = new JsonRpcRouter<AuthResult | undefined>();
  const sseConnections = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();

  const pushNotificationManager = options.pushNotificationManager ?? new PushNotificationManager();
  const pushNotificationsSupported = agentCard.capabilities.pushNotifications ?? false;

  function addSseConnection(
    taskId: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    let connections = sseConnections.get(taskId);
    if (!connections) {
      connections = new Set();
      sseConnections.set(taskId, connections);
    }
    connections.add(controller);
  }

  function removeSseConnection(
    taskId: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    const connections = sseConnections.get(taskId);
    if (!connections) return;
    connections.delete(controller);
    if (connections.size === 0) {
      sseConnections.delete(taskId);
    }
  }

  async function shutdownSse(): Promise<void> {
    for (const [, connections] of sseConnections) {
      for (const controller of connections) {
        try {
          controller.close();
        } catch {
          /* ignore close errors */
        }
      }
    }
    sseConnections.clear();
  }

  function broadcastToTask(taskId: string, data: unknown): void {
    const connections = sseConnections.get(taskId);
    if (!connections) return;
    const payload = new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
    for (const controller of connections) {
      try {
        controller.enqueue(payload);
      } catch {
        removeSseConnection(taskId, controller);
      }
    }
  }

  const app = new Hono<{ Variables: Variables }>();

  app.onError((err, c) => {
    defaultLogger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Unhandled server error',
    );
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  // Rate limiting middleware
  const rateLimiter = options.rateLimiter;
  if (rateLimiter) {
    const trustProxy = options.trustProxyHeaders ?? false;
    app.use(async (c, next) => {
      let clientIp = 'unknown';
      if (trustProxy) {
        const forwarded = c.req.header('x-forwarded-for');
        const cfIp = c.req.header('cf-connecting-ip');
        const realIp = c.req.header('x-real-ip');
        clientIp = forwarded ? forwarded.split(',')[0].trim() : (cfIp ?? realIp ?? 'unknown');
      } else {
        // Best-effort peer address from the underlying adapter (e.g. @hono/node-server);
        // forwarding headers are ignored unless trustProxyHeaders is enabled.
        const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
        clientIp = env?.incoming?.socket?.remoteAddress ?? 'unknown';
      }
      const result = rateLimiter.check({
        ip: clientIp,
        headers: Object.fromEntries(
          Array.from(c.req.raw.headers.entries()).map(([k, v]) => [k, v]),
        ),
      });
      if (!result.allowed) {
        const retryAfterSeconds = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
        c.res.headers.set('Retry-After', retryAfterSeconds.toString());
        return c.json({ error: 'Too Many Requests', retryAfter: retryAfterSeconds }, 429);
      }
      c.res.headers.set('X-RateLimit-Remaining', result.remaining.toString());
      return next();
    });
  }

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

  // Health check endpoints
  app.get('/healthz', async (c: Context) => {
    const status = await createHealthStatus({
      taskStore,
      version: options.version ?? agentCard.version,
      startTime,
      checks: options.healthChecks,
    });
    const httpStatus = status.status === 'ok' ? 200 : status.status === 'degraded' ? 200 : 503;
    return c.json(status, httpStatus);
  });

  app.get('/readyz', async (c: Context) => {
    const status = await createHealthStatus({
      taskStore,
      version: options.version ?? agentCard.version,
      startTime,
      checks: options.healthChecks,
    });
    const httpStatus = status.status === 'unhealthy' ? 503 : 200;
    return c.json(status, httpStatus);
  });

  // Agent Card discovery
  app.get('/.well-known/agent.json', (c: Context) => {
    return c.json(agentCard);
  });

  app.get('/.well-known/agent-card', (c: Context) => {
    return c.json(agentCard);
  });

  // Extended Agent Card
  app.get('/.well-known/agent-card/extended', (c: Context) => {
    if (!options.extendedAgentCard) {
      return c.json({ error: 'Extended agent card not configured' }, 404);
    }
    return c.json(options.extendedAgentCard);
  });

  // JSON-RPC endpoint
  app.post('/', async (c: Context) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        400,
      );
    }
    const auth = c.get('auth');
    try {
      const response = await rpc.handle(body, auth);
      return c.json(response);
    } catch (err) {
      defaultLogger.error({ err }, 'rpc.handle() threw unexpected error');
      return c.json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal error' },
      });
    }
  });

  // SSE streaming endpoint for tasks/sendSubscribe
  app.post('/tasks/sendSubscribe', async (c: Context) => {
    let params: unknown;
    try {
      params = await c.req.json();
    } catch {
      return c.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        400,
      );
    }
    let validated: z.infer<typeof SendMessageRequestSchema>;
    try {
      validated = SendMessageRequestSchema.parse(params);
    } catch {
      return c.json(
        { jsonrpc: '2.0', id: null, error: { code: -32602, message: 'Invalid params' } },
        400,
      );
    }
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
        addSseConnection(taskId, controller);

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
              createEventBus(taskId, taskStore, broadcastToTask, pushNotificationManager),
            );
            const finalTask = await taskStore.get(taskId);
            if (finalTask && finalTask.status.state === 'working') {
              const statusUpdate = {
                state: 'completed' as const,
                timestamp: new Date().toISOString(),
              };
              await taskStore.updateStatus(taskId, statusUpdate);
              broadcastToTask(taskId, {
                kind: 'status',
                status: statusUpdate,
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
              removeSseConnection(taskId, controller);
              try {
                controller.close();
              } catch {
                /* ignore close errors */
              }
            }, 500);
          }
        })();
      },
      cancel(controller) {
        removeSseConnection(taskId, controller);
        try {
          controller.close();
        } catch {
          /* ignore */
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
        addSseConnection(taskId, controller);

        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'task', task })}\n\n`),
        );

        c.req.raw.signal.addEventListener('abort', () => {
          removeSseConnection(taskId, controller);
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
        const updatedTask = await taskStore.get(taskId);
        await executor.execute(
          { task: updatedTask ?? task, message },
          createEventBus(taskId, taskStore, broadcastToTask, pushNotificationManager),
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
      // Scope the query (and thus totalSize/pagination) to the caller's principal.
      principal: auth?.principal,
      pageSize: validated.pageSize,
      pageToken: validated.pageToken,
    });
    // Defense-in-depth: the store already filtered by principal, so this is a no-op
    // for principal-scoped stores but guards any store that ignores the option.
    const filtered = filterByPrincipal(result.tasks, auth);
    return {
      tasks: filtered,
      nextPageToken: result.nextPageToken,
      totalSize: result.totalSize,
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
      await executor.cancelTask(
        task.id,
        createEventBus(task.id, taskStore, broadcastToTask, pushNotificationManager),
      );
    }

    const updated = await taskStore.cancel(task.id);
    broadcastToTask(task.id, {
      kind: 'status',
      status: { state: 'canceled' },
      final: true,
    });
    return updated;
  });

  // tasks/sendSubscribe (JSON-RPC style)
  rpc.register('tasks/sendSubscribe', async (params, auth) => {
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
          createEventBus(taskId, taskStore, broadcastToTask, pushNotificationManager),
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

  // Push notification config management
  rpc.register('tasks/pushNotification/set', async (params, _auth) => {
    if (!pushNotificationsSupported) {
      throw new PushNotificationNotSupportedError();
    }
    const config = TaskPushNotificationConfigSchema.parse(params);
    pushNotificationManager.register(config);
    return { ok: true, id: config.id };
  });

  rpc.register('tasks/pushNotification/get', async (params, _auth) => {
    if (!pushNotificationsSupported) {
      throw new PushNotificationNotSupportedError();
    }
    const { taskId } = z.object({ taskId: z.string() }).parse(params);
    const config = pushNotificationManager.getConfig(taskId);
    if (!config) {
      throw new TaskNotFoundError(taskId);
    }
    return config;
  });

  rpc.register('tasks/pushNotification/list', async (params, _auth) => {
    if (!pushNotificationsSupported) {
      throw new PushNotificationNotSupportedError();
    }
    const { taskId } = z.object({ taskId: z.string().optional() }).parse(params);
    return { configs: pushNotificationManager.listConfigs(taskId) };
  });

  rpc.register('tasks/pushNotification/delete', async (params, _auth) => {
    if (!pushNotificationsSupported) {
      throw new PushNotificationNotSupportedError();
    }
    const { taskId } = z.object({ taskId: z.string() }).parse(params);
    pushNotificationManager.unregister(taskId);
    return { ok: true };
  });

  // Extended agent card
  rpc.register('tasks/extendedAgentCard', async (params, _auth) => {
    if (!options.extendedAgentCard) {
      throw new ExtendedAgentCardNotConfiguredError();
    }
    GetExtendedAgentCardRequestSchema.parse(params);
    return options.extendedAgentCard;
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
