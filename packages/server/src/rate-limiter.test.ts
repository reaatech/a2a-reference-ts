import type { Logger } from '@reaatech/a2a-reference-observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows a request under the max limit', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 10 });

    const result = limiter.check({ ip: '127.0.0.1', headers: {} });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(typeof result.resetAt).toBe('number');
  });

  it('returns correct remaining count for multiple requests', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const req = { ip: '127.0.0.1', headers: {} };

    expect(limiter.check(req).remaining).toBe(4);
    expect(limiter.check(req).remaining).toBe(3);
    expect(limiter.check(req).remaining).toBe(2);
    expect(limiter.check(req).remaining).toBe(1);
    expect(limiter.check(req).remaining).toBe(0);
  });

  it('blocks requests over the max limit', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });
    const req = { ip: '127.0.0.1', headers: {} };

    limiter.check(req);
    limiter.check(req);
    limiter.check(req);

    const result = limiter.check(req);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets the window after windowMs elapses', () => {
    const limiter = new RateLimiter({ windowMs: 10_000, maxRequests: 2 });
    const req = { ip: '127.0.0.1', headers: {} };

    limiter.check(req);
    limiter.check(req);
    // Exhausted
    expect(limiter.check(req).allowed).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(10_000);

    // Should reset
    const result = limiter.check(req);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('resets the window for each key independently', () => {
    const limiter = new RateLimiter({ windowMs: 10_000, maxRequests: 2 });
    const reqA = { ip: '10.0.0.1', headers: {} };
    const reqB = { ip: '10.0.0.2', headers: {} };

    limiter.check(reqA);
    limiter.check(reqA);
    expect(limiter.check(reqA).allowed).toBe(false);

    // Different IP should still be allowed
    expect(limiter.check(reqB).allowed).toBe(true);

    // Advance time
    vi.advanceTimersByTime(10_000);

    // Both should be reset
    expect(limiter.check(reqA).allowed).toBe(true);
    expect(limiter.check(reqB).remaining).toBe(1);
  });

  it('uses custom key function', () => {
    const limiter = new RateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      keyFn: (req) => {
        const header = req.headers['x-api-key'];
        const value = Array.isArray(header) ? header[0] : header;
        return value ?? 'unknown';
      },
    });

    const req = { ip: '127.0.0.1', headers: { 'x-api-key': 'key-1' } };

    expect(limiter.check(req).allowed).toBe(true);
    // Same key → blocked
    expect(limiter.check(req).allowed).toBe(false);

    // Different key → allowed
    const req2 = { ip: '127.0.0.1', headers: { 'x-api-key': 'key-2' } };
    expect(limiter.check(req2).allowed).toBe(true);
  });

  it('falls back to "unknown" when no ip and no custom keyFn', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req = { headers: {} };

    expect(limiter.check(req).allowed).toBe(true);
    expect(limiter.check(req).allowed).toBe(true);
    expect(limiter.check(req).allowed).toBe(false);
  });

  it('uses array header values correctly in default keyFn', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req = { headers: { 'x-forwarded-for': ['10.0.0.1'] } } as {
      ip?: string;
      headers: Record<string, string | string[] | undefined>;
    };

    // Default keyFn uses req.ip, not x-forwarded-for, so ip is undefined
    const r1 = limiter.check(req);
    // "unknown" key
    expect(r1.allowed).toBe(true);
  });

  it('logs a warning when rate limit is exceeded', () => {
    const warnFn = vi.fn();
    const limiter = new RateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      logger: {
        warn: warnFn,
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        silent: vi.fn(),
      } as unknown as Logger,
    });
    const req = { ip: '10.0.0.1', headers: {} };

    limiter.check(req);
    expect(warnFn).not.toHaveBeenCalled();

    limiter.check(req);
    expect(warnFn).toHaveBeenCalledTimes(1);
    expect(warnFn).toHaveBeenCalledWith(
      expect.objectContaining({ key: '10.0.0.1', count: 2, limit: 1 }),
      'rate limit exceeded',
    );
  });

  it('cleanup removes expired entries', () => {
    const limiter = new RateLimiter({ windowMs: 10_000, maxRequests: 10 });

    limiter.check({ ip: '10.0.0.1', headers: {} });
    limiter.check({ ip: '10.0.0.2', headers: {} });

    // Advance time past the window
    vi.advanceTimersByTime(10_000);

    // Trigger cleanup (removes only expired entries)
    limiter.cleanup();

    // After cleanup, fresh window
    const result = limiter.check({ ip: '10.0.0.1', headers: {} });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('close clears the interval and windows', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 10 });

    limiter.check({ ip: '10.0.0.1', headers: {} });
    limiter.close();

    // After close, windows should be empty
    const result = limiter.check({ ip: '10.0.0.1', headers: {} });
    // It'll start fresh since windows were cleared
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('reset clears all windows', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req = { ip: '10.0.0.1', headers: {} };

    limiter.check(req);
    limiter.check(req);
    expect(limiter.check(req).allowed).toBe(false);

    limiter.reset();

    expect(limiter.check(req).allowed).toBe(true);
    expect(limiter.check(req).remaining).toBe(0);
  });

  it('applies default options when none are provided', () => {
    const limiter = new RateLimiter();
    const req = { ip: '127.0.0.1', headers: {} };

    for (let i = 0; i < 100; i++) {
      limiter.check(req);
    }
    // 100th should be at exactly the limit → allowed
    expect(limiter.check(req).allowed).toBe(false);
  });
});
