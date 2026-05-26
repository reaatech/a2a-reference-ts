import { type Logger, defaultLogger } from '@reaatech/a2a-reference-observability';

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  keyFn?: (req: { ip?: string; headers: Record<string, string | string[] | undefined> }) => string;
  logger?: Logger;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory sliding-window rate limiter.
 *
 * For distributed deployments, a shared store backend (e.g. Redis) should be
 * provided via a custom rate limiting implementation.
 */
export class RateLimiter {
  private windows = new Map<string, WindowEntry>();
  private windowMs: number;
  private maxRequests: number;
  private keyFn: NonNullable<RateLimiterOptions['keyFn']>;
  private logger: Logger;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(options?: RateLimiterOptions) {
    this.windowMs = options?.windowMs ?? 60_000;
    this.maxRequests = options?.maxRequests ?? 100;
    this.keyFn = options?.keyFn ?? ((req) => req.ip ?? 'unknown');
    this.logger = options?.logger ?? defaultLogger;
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs * 2);
    this.cleanupInterval.unref();
  }

  check(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const key = this.keyFn(req);
    const now = Date.now();
    let entry = this.windows.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 1, resetAt: now + this.windowMs };
      this.windows.set(key, entry);
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: entry.resetAt };
    }

    entry.count++;
    if (entry.count > this.maxRequests) {
      this.logger.warn({ key, count: entry.count, limit: this.maxRequests }, 'rate limit exceeded');
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    return { allowed: true, remaining: this.maxRequests - entry.count, resetAt: entry.resetAt };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) {
        this.windows.delete(key);
      }
    }
  }

  close(): void {
    clearInterval(this.cleanupInterval);
    this.windows.clear();
  }

  reset(): void {
    this.windows.clear();
  }
}
