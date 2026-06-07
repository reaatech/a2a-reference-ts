import { describe, expect, it, vi } from 'vitest';
import { RedisSseCoordinator } from './sse-redis.js';

function createMockRedis() {
  const handlers = new Map<string, (...args: string[]) => void>();
  return {
    duplicate: vi.fn().mockReturnThis(),
    psubscribe: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(1),
    punsubscribe: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, handler: (...args: string[]) => void) => {
      handlers.set(event, handler);
    }),
    emit: vi.fn((event: string, ...args: string[]) => {
      const h = handlers.get(event);
      if (h) h(...args);
    }),
  };
}

type MockRedis = ReturnType<typeof createMockRedis>;

describe('RedisSseCoordinator', () => {
  describe('connect', () => {
    it('creates a subscriber and subscribes to the psubject', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
        channelPrefix: 'a2a:sse',
      });

      await coordinator.connect();

      expect(redis.duplicate).toHaveBeenCalledOnce();
      expect(redis.psubscribe).toHaveBeenCalledWith('a2a:sse:*');
    });

    it('does nothing if already connected', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
      });

      await coordinator.connect();
      await coordinator.connect();

      expect(redis.duplicate).toHaveBeenCalledTimes(1);
      expect(redis.psubscribe).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent connect calls', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
      });

      await Promise.all([coordinator.connect(), coordinator.connect()]);

      expect(redis.duplicate).toHaveBeenCalledTimes(1);
      expect(redis.psubscribe).toHaveBeenCalledTimes(1);
    });

    it('connects on init when connectOnInit is true', async () => {
      const redis: MockRedis = createMockRedis();
      void new RedisSseCoordinator({
        redis: redis as never,
        connectOnInit: true,
      });

      expect(redis.duplicate).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(redis.psubscribe).toHaveBeenCalledWith('a2a:sse:*');
      });
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('calls the handler when a matching message is received', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
        channelPrefix: 'a2a:sse',
      });
      await coordinator.connect();

      const handler = vi.fn();
      coordinator.subscribe('task-1', handler);

      redis.emit('pmessage', 'a2a:sse:*', 'a2a:sse:task-1', JSON.stringify({ hello: 'world' }));

      expect(handler).toHaveBeenCalledWith({ hello: 'world' });
    });

    it('does not call the handler for a different task', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
      });
      await coordinator.connect();

      const handler = vi.fn();
      coordinator.subscribe('task-1', handler);

      redis.emit('pmessage', 'a2a:sse:*', 'a2a:sse:task-2', JSON.stringify({}));

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not call the handler after unsubscribe', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
      });
      await coordinator.connect();

      const handler = vi.fn();
      coordinator.subscribe('task-1', handler);
      coordinator.unsubscribe('task-1');

      redis.emit('pmessage', 'a2a:sse:*', 'a2a:sse:task-1', JSON.stringify({}));

      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores malformed JSON messages', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
      });
      await coordinator.connect();

      const handler = vi.fn();
      coordinator.subscribe('task-1', handler);

      redis.emit('pmessage', 'a2a:sse:*', 'a2a:sse:task-1', 'not-json');

      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores messages on channels without the prefix', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
      });
      await coordinator.connect();

      const handler = vi.fn();
      coordinator.subscribe('task-1', handler);

      redis.emit('pmessage', 'a2a:sse:*', 'other:task-1', JSON.stringify({}));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('publishes JSON-stringified data to the correct channel', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
        channelPrefix: 'a2a:sse',
      });

      await coordinator.publish('task-1', { status: 'ok' });

      expect(redis.publish).toHaveBeenCalledWith(
        'a2a:sse:task-1',
        JSON.stringify({ status: 'ok' }),
      );
    });

    it('uses custom channel prefix', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
        channelPrefix: 'custom',
      });

      await coordinator.publish('task-99', { data: 1 });

      expect(redis.publish).toHaveBeenCalledWith('custom:task-99', JSON.stringify({ data: 1 }));
    });
  });

  describe('close', () => {
    it('unsubscribes and quits the subscriber', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
      });
      await coordinator.connect();

      await coordinator.close();

      expect(redis.punsubscribe).toHaveBeenCalledOnce();
      expect(redis.quit).toHaveBeenCalledOnce();
    });

    it('clears all handlers', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
      });
      await coordinator.connect();

      coordinator.subscribe('task-1', vi.fn());
      coordinator.subscribe('task-2', vi.fn());

      await coordinator.close();

      redis.emit('pmessage', 'a2a:sse:*', 'a2a:sse:task-1', JSON.stringify({}));

      // No handler should be called since they were cleared
    });

    it('is a no-op when not connected', async () => {
      const redis: MockRedis = createMockRedis();
      const coordinator = new RedisSseCoordinator({
        redis: redis as never,
      });

      await coordinator.close();

      expect(redis.punsubscribe).not.toHaveBeenCalled();
      expect(redis.quit).not.toHaveBeenCalled();
    });
  });
});
