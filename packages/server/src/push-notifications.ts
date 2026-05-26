import type {
  Task,
  TaskArtifactUpdateEvent,
  TaskPushNotificationConfig,
  TaskStatusUpdateEvent,
} from '@reaatech/a2a-reference-core';
import { type Logger, defaultLogger } from '@reaatech/a2a-reference-observability';

const DEFAULT_USER_AGENT = 'a2a-reference-push-notification/0.1.0';

export interface PushNotificationManagerOptions {
  logger?: Logger;
  maxRetries?: number;
  retryDelayMs?: number;
  maxDedupEntries?: number;
  userAgent?: string;
}

const DEFAULT_MAX_DEDUP_ENTRIES = 10_000;

export class PushNotificationManager {
  private configs = new Map<string, TaskPushNotificationConfig>();
  private sentNotifications = new Map<string, number>();
  private logger: Logger;
  private maxRetries: number;
  private retryDelayMs: number;
  private maxDedupEntries: number;
  private userAgent: string;

  constructor(options?: PushNotificationManagerOptions) {
    this.logger = options?.logger ?? defaultLogger;
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
    this.maxDedupEntries = options?.maxDedupEntries ?? DEFAULT_MAX_DEDUP_ENTRIES;
    this.userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;
  }

  register(config: TaskPushNotificationConfig): void {
    if (!config.taskId) {
      // Message wording maps to a JSON-RPC -32602 (invalid params) in JsonRpcRouter.
      throw new Error('invalid push notification config: taskId is required');
    }
    this.configs.set(config.taskId, config);
    this.logger.info({ taskId: config.taskId }, 'push notification config registered');
  }

  unregister(taskId: string): void {
    this.configs.delete(taskId);
  }

  getConfig(taskId: string): TaskPushNotificationConfig | undefined {
    return this.configs.get(taskId);
  }

  listConfigs(taskId?: string): TaskPushNotificationConfig[] {
    if (taskId) {
      const config = this.configs.get(taskId);
      return config ? [config] : [];
    }
    return Array.from(this.configs.values());
  }

  unregisterAll(taskId?: string): void {
    if (taskId) {
      this.configs.delete(taskId);
    } else {
      this.configs.clear();
    }
  }

  async notifyStatusUpdate(task: Task, event: TaskStatusUpdateEvent): Promise<boolean> {
    const config = this.configs.get(task.id);
    if (!config) return false;

    const dedupKey = `${task.id}:status:${event.status.state}:${event.status.timestamp ?? Date.now()}`;
    if (this.sentNotifications.has(dedupKey)) return true;
    this.evictDedupIfNeeded();
    this.sentNotifications.set(dedupKey, Date.now());

    return this.deliver(config, {
      kind: 'status',
      taskId: task.id,
      status: event.status,
      final: event.final,
    });
  }

  async notifyArtifactUpdate(task: Task, event: TaskArtifactUpdateEvent): Promise<boolean> {
    const config = this.configs.get(task.id);
    if (!config) return false;

    return this.deliver(config, {
      kind: 'artifact',
      taskId: task.id,
      artifact: event.artifact,
      append: event.append,
      lastChunk: event.lastChunk,
    });
  }

  private evictDedupIfNeeded(): void {
    if (this.sentNotifications.size < this.maxDedupEntries) return;
    const sorted = Array.from(this.sentNotifications.entries()).sort(([, a], [, b]) => a - b);
    const toDelete = sorted.slice(0, Math.floor(this.maxDedupEntries * 0.5));
    for (const [key] of toDelete) {
      this.sentNotifications.delete(key);
    }
  }

  private getAuthHeader(config: TaskPushNotificationConfig): [string, string] | null {
    if (config.token) {
      return ['Authorization', `Bearer ${config.token}`];
    }

    if (
      config.authentication &&
      typeof config.authentication === 'object' &&
      !Array.isArray(config.authentication)
    ) {
      const auth = config.authentication as Record<string, unknown>;
      if (auth.scheme === 'apiKey' && typeof auth.credentials === 'string') {
        const headerName = typeof auth.headerName === 'string' ? auth.headerName : 'x-api-key';
        return [headerName, auth.credentials];
      }
    }

    return null;
  }

  private async deliver(config: TaskPushNotificationConfig, payload: unknown): Promise<boolean> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
    };

    const authHeader = this.getAuthHeader(config);
    if (authHeader) {
      headers[authHeader[0]] = authHeader[1];
    }

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        try {
          const response = await fetch(config.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (response.ok) {
            return true;
          }

          const body = await response.text().catch(() => '');
          this.logger.warn(
            { url: config.url, status: response.status, body, attempt },
            'push notification delivery failed',
          );
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err) {
        this.logger.error(
          { url: config.url, attempt, error: err instanceof Error ? err.message : String(err) },
          'push notification delivery error',
        );
      }

      if (attempt < this.maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * 2 ** attempt));
      }
    }

    return false;
  }
}
