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
import express, { type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import type { AgentExecutor } from './executor.js';
import { JsonRpcRouter } from './json-rpc.js';
import { createEventBus, enforcePrincipal, filterByPrincipal, generateTaskId } from './shared.js';

export interface A2AServerOptions {
  agentCard: AgentCard;
  executor: AgentExecutor;
  taskStore?: TaskStore;
  authStrategy?: AuthStrategy;
}

export interface A2AServerShutdownOptions {
  timeoutMs?: number;
}

const authMap = new WeakMap<Request, AuthResult>();

function getAuth(req: Request): AuthResult | undefined {
  return authMap.get(req);
}

export function createA2AExpressApp(
  options: A2AServerOptions,
): express.Express & { shutdown: (opts?: A2AServerShutdownOptions) => Promise<void> } {
  const app = express();
  app.use(express.json());
  const router = createA2ARouter(options);
  app.use(router);

  const shutdown = async (opts?: A2AServerShutdownOptions) => {
    const timeoutMs = opts?.timeoutMs ?? 10_000;
    const deadline = Date.now() + timeoutMs;

    // Close all SSE connections gracefully
    if ('shutdownSse' in router && typeof router.shutdownSse === 'function') {
      await router.shutdownSse();
    }

    // Give in-flight tasks a moment to complete
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(remaining, 1000)));
    }
  };

  return Object.assign(app, { shutdown });
}

export function createA2ARouter(
  options: A2AServerOptions,
): Router & { shutdownSse: () => Promise<void> } {
  const { agentCard, executor } = options;
  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const router = express.Router();
  const rpc = new JsonRpcRouter<AuthResult | undefined>();

  // Authentication middleware
  const authStrategy = options.authStrategy;
  if (authStrategy) {
    router.use(async (req: Request, res: Response, next) => {
      const result = await authStrategy.authenticate({
        headers: Object.fromEntries(Object.entries(req.headers)),
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

  async function shutdownSse(): Promise<void> {
    for (const [taskId, connections] of sseConnections) {
      for (const res of connections) {
        try {
          res.end();
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
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of connections) {
      res.write(payload);
    }
  }

  // Agent Card discovery
  router.get('/.well-known/agent.json', (_req: Request, res: Response) => {
    res.json(agentCard);
  });

  router.get('/.well-known/agent-card', (_req: Request, res: Response) => {
    res.json(agentCard);
  });

  // JSON-RPC endpoint
  router.post('/', async (req: Request, res: Response) => {
    const response = await rpc.handle(req.body, getAuth(req));
    res.json(response);
  });

  // SSE streaming endpoint for tasks/sendSubscribe
  router.post('/tasks/sendSubscribe', async (req: Request, res: Response) => {
    let validated: z.infer<typeof SendMessageRequestSchema>;
    try {
      validated = SendMessageRequestSchema.parse(req.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid request body';
      res.status(400).json({ error: 'InvalidParams', message });
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

    const connections = sseConnections.get(taskId) ?? new Set();
    connections.add(res);
    sseConnections.set(taskId, connections);

    req.on('close', () => {
      connections.delete(res);
      if (connections.size === 0) {
        sseConnections.delete(taskId);
      }
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
        // Give SSE clients a moment to receive final events before closing
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

    const connections = sseConnections.get(taskId) ?? new Set();
    connections.add(res);
    sseConnections.set(taskId, connections);

    req.on('close', () => {
      connections.delete(res);
      if (connections.size === 0) {
        sseConnections.delete(taskId);
      }
    });

    // Send current task state
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

    // Transition to working and execute
    await taskStore.updateStatus(taskId, { state: 'working', timestamp: new Date().toISOString() });

    // Execute asynchronously
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

  return Object.assign(router, { shutdownSse });
}
