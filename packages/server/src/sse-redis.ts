import { defaultLogger } from '@reaatech/a2a-reference-observability';
import type { Redis } from 'ioredis';

export interface RedisSseCoordinatorOptions {
  redis: Redis;
  channelPrefix?: string;
  connectOnInit?: boolean;
}

const DEFAULT_CHANNEL_PREFIX = 'a2a:sse';

export class RedisSseCoordinator {
  private redis: Redis;
  private subscriber: Redis | null = null;
  private channelPrefix: string;
  private handlers = new Map<string, (data: unknown) => void>();
  private connecting: Promise<void> | null = null;

  constructor(options: RedisSseCoordinatorOptions) {
    this.redis = options.redis;
    this.channelPrefix = options.channelPrefix ?? DEFAULT_CHANNEL_PREFIX;

    if (options.connectOnInit) {
      this.connect().catch((err: unknown) => {
        defaultLogger.warn({ err }, 'RedisSseCoordinator: failed to connect on init');
      });
    }
  }

  private channelName(taskId: string): string {
    return `${this.channelPrefix}:${taskId}`;
  }

  async connect(): Promise<void> {
    if (this.subscriber) return;
    if (this.connecting) return this.connecting;

    this.connecting = this._connect().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private async _connect(): Promise<void> {
    const sub = this.redis.duplicate();

    sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const prefix = `${this.channelPrefix}:`;
      if (!channel.startsWith(prefix)) return;

      const taskId = channel.slice(prefix.length);
      const handler = this.handlers.get(taskId);
      if (handler) {
        try {
          const data = JSON.parse(message);
          handler(data);
        } catch {
          defaultLogger.debug({ channel, message }, 'RedisSseCoordinator: malformed JSON message');
        }
      }
    });

    await sub.psubscribe(`${this.channelPrefix}:*`);
    this.subscriber = sub;
  }

  subscribe(taskId: string, handler: (data: unknown) => void): void {
    this.handlers.set(taskId, handler);
  }

  unsubscribe(taskId: string): void {
    this.handlers.delete(taskId);
  }

  async publish(taskId: string, data: unknown): Promise<void> {
    const message = JSON.stringify(data);
    await this.redis.publish(this.channelName(taskId), message);
  }

  async close(): Promise<void> {
    const sub = this.subscriber;
    if (!sub) return;

    this.subscriber = null;
    this.handlers.clear();

    try {
      await sub.punsubscribe();
      await sub.quit();
    } catch {
      // ignore close errors
    }
  }
}
