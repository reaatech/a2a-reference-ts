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
import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import type { AgentExecutor } from './executor.js';
import { type HealthCheck, createHealthStatus } from './health.js';
import { JsonRpcRouter } from './json-rpc.js';
import { PushNotificationManager } from './push-notifications.js';
import type { RateLimiter } from './rate-limiter.js';
import { createEventBus, enforcePrincipal, filterByPrincipal, generateTaskId } from './shared.js';

export interface A2AServerOptions {
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
   * (`X-Forwarded-For`). Only enable this behind a trusted proxy that overwrites
   * the header — otherwise clients can spoof it to evade or poison rate limits.
   * Defaults to `false` (uses the socket peer address).
   */
  trustProxyHeaders?: boolean;
}

export interface A2AServerShutdownOptions {
  timeoutMs?: number;
}

const authMap = new WeakMap<Request, AuthResult>();

function getAuth(req: Request): AuthResult | undefined {
  return authMap.get(req);
}

function getHeaders(req: Request): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers[key] = value;
    }
  }
  return headers;
}

function getClientIp(req: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    if (Array.isArray(forwarded)) return forwarded[0].trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function createA2AExpressApp(
  options: A2AServerOptions,
): express.Express & { shutdown: (opts?: A2AServerShutdownOptions) => Promise<void> } {
  const app = express();
  app.use(express.json());

  app.use(
    (
      err: Error & { type?: string },
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
        res
          .status(400)
          .json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      next(err);
    },
  );

  const router = createA2ARouter(options);
  app.use(router);

  app.use(
    (_err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      defaultLogger.error({ err: _err }, 'Unhandled server error');
      res.status(500).json({ error: 'Internal Server Error' });
    },
  );

  const shutdown = async (opts?: A2AServerShutdownOptions) => {
    const timeoutMs = opts?.timeoutMs ?? 10_000;
    const deadline = Date.now() + timeoutMs;

    if ('shutdownSse' in router && typeof router.shutdownSse === 'function') {
      await router.shutdownSse();
    }

    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(remaining, 1000)));
    }
  };

  return Object.assign(app, { shutdown });
}

const startTime = Date.now();

export function createA2ARouter(
  options: A2AServerOptions,
): Router & { shutdownSse: () => Promise<void> } {
  const { agentCard, executor } = options;
  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const router = express.Router();
  const rpc = new JsonRpcRouter<AuthResult | undefined>();

  const pushNotificationManager = options.pushNotificationManager ?? new PushNotificationManager();
  const pushNotificationsSupported = agentCard.capabilities.pushNotifications ?? false;

  // Rate limiting middleware
  const rateLimiter = options.rateLimiter;
  if (rateLimiter) {
    const trustProxy = options.trustProxyHeaders ?? false;
    router.use((req: Request, res: Response, next) => {
      const result = rateLimiter.check({ ip: getClientIp(req, trustProxy), headers: req.headers });
      if (!result.allowed) {
        const retryAfterSeconds = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
        res.setHeader('Retry-After', retryAfterSeconds.toString());
        res.status(429).json({ error: 'Too Many Requests', retryAfter: retryAfterSeconds });
        return;
      }
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      next();
    });
  }

  // Authentication middleware
  const authStrategy = options.authStrategy;
  if (authStrategy) {
    router.use(async (req: Request, res: Response, next) => {
      const result = await authStrategy.authenticate({
        headers: getHeaders(req),
      });
      if (!result.authenticated) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      authMap.set(req, result);
      next();
    });
  }

  // Track active SSE connections per task
  const sseConnections = new Map<string, Set<Response>>();

  function addSseConnection(taskId: string, res: Response): void {
    let connections = sseConnections.get(taskId);
    if (!connections) {
      connections = new Set();
      sseConnections.set(taskId, connections);
    }
    connections.add(res);
  }

  function removeSseConnection(taskId: string, res: Response): void {
    const connections = sseConnections.get(taskId);
    if (!connections) return;
    connections.delete(res);
    if (connections.size === 0) {
      sseConnections.delete(taskId);
    }
  }

  async function shutdownSse(): Promise<void> {
    for (const [, connections] of sseConnections) {
      for (const res of connections) {
        try {
          res.end();
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
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of connections) {
      if (res.writableEnded) {
        removeSseConnection(taskId, res);
        continue;
      }
      try {
        res.write(payload);
      } catch {
        removeSseConnection(taskId, res);
      }
    }
  }

  // Health check endpoints
  router.get('/healthz', async (_req: Request, res: Response) => {
    const status = await createHealthStatus({
      taskStore,
      version: options.version ?? agentCard.version,
      startTime,
      checks: options.healthChecks,
    });
    const httpStatus = status.status === 'ok' ? 200 : status.status === 'degraded' ? 200 : 503;
    res.status(httpStatus).json(status);
  });

  router.get('/readyz', async (_req: Request, res: Response) => {
    const status = await createHealthStatus({
      taskStore,
      version: options.version ?? agentCard.version,
      startTime,
      checks: options.healthChecks,
    });
    const httpStatus = status.status === 'unhealthy' ? 503 : 200;
    res.status(httpStatus).json(status);
  });

  // Agent Card discovery
  router.get('/.well-known/agent.json', (_req: Request, res: Response) => {
    res.json(agentCard);
  });

  router.get('/.well-known/agent-card', (_req: Request, res: Response) => {
    res.json(agentCard);
  });

  // Extended Agent Card
  router.get('/.well-known/agent-card/extended', (_req: Request, res: Response) => {
    if (!options.extendedAgentCard) {
      res.status(404).json({ error: 'Extended agent card not configured' });
      return;
    }
    res.json(options.extendedAgentCard);
  });

  // JSON-RPC endpoint
  router.post('/', async (req: Request, res: Response) => {
    try {
      const response = await rpc.handle(req.body, getAuth(req));
      res.json(response);
    } catch (err) {
      defaultLogger.error({ err }, 'rpc.handle() threw unexpected error');
      res.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }
  });

  // SSE streaming endpoint for tasks/sendSubscribe
  router.post('/tasks/sendSubscribe', async (req: Request, res: Response) => {
    let validated: z.infer<typeof SendMessageRequestSchema>;
    try {
      validated = SendMessageRequestSchema.parse(req.body);
    } catch {
      res
        .status(400)
        .json({ jsonrpc: '2.0', id: null, error: { code: -32602, message: 'Invalid params' } });
      return;
    }
    const message = validated.message;
    const taskId = validated.taskId || generateTaskId();
    const auth = getAuth(req);

    const task: Task = {
      id: taskId,
      contextId: validated.contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [message],
      metadata: {},
      principal: auth?.principal,
    };
    await taskStore.create(task);

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    addSseConnection(taskId, res);

    req.on('close', () => {
      removeSseConnection(taskId, res);
      authMap.delete(req);
    });

    // Send initial task
    res.write(`data: ${JSON.stringify({ kind: 'task', task })}\n\n`);

    // Transition to working and execute
    await taskStore.updateStatus(taskId, { state: 'working', timestamp: new Date().toISOString() });
    broadcastToTask(taskId, { kind: 'status', status: { state: 'working' } });

    // Execute asynchronously
    (async () => {
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
          res.end();
        }, 500);
      }
    })();
  });

  // SSE subscription endpoint for existing tasks
  router.get('/tasks/:taskId/subscribe', async (req: Request, res: Response) => {
    const taskId = z.string().parse(req.params.taskId);
    const task = await taskStore.get(taskId);
    if (!task) {
      res.status(404).json({ error: `Task not found: ${taskId}` });
      return;
    }

    const auth = getAuth(req);
    if (enforcePrincipal(task, auth) === undefined) {
      res.status(404).json({ error: `Task not found: ${taskId}` });
      return;
    }

    const terminalStates = ['completed', 'failed', 'canceled', 'rejected'];
    if (terminalStates.includes(task.status.state)) {
      res.status(400).json({ error: 'Task is in a terminal state' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    addSseConnection(taskId, res);

    req.on('close', () => {
      removeSseConnection(taskId, res);
      authMap.delete(req);
    });

    res.write(`data: ${JSON.stringify({ kind: 'task', task })}\n\n`);
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
  rpc.register('tasks/extendedAgentCard', async (params) => {
    if (!options.extendedAgentCard) {
      throw new ExtendedAgentCardNotConfiguredError();
    }
    GetExtendedAgentCardRequestSchema.parse(params);
    return options.extendedAgentCard;
  });

  return Object.assign(router, { shutdownSse });
}
