import type { Task, TaskPushNotificationConfig } from '@reaatech/a2a-reference-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushNotificationManager } from './push-notifications.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    status: { state: 'submitted', timestamp: new Date().toISOString() },
    ...overrides,
  };
}

function makeConfig(
  overrides: Partial<TaskPushNotificationConfig> = {},
): TaskPushNotificationConfig {
  return {
    url: 'https://example.com/webhook',
    taskId: 'task-1',
    ...overrides,
  };
}

function makeStatusEvent(status: Task['status']['state'] = 'completed', final = true) {
  return {
    kind: 'status' as const,
    taskId: 'task-1',
    status: { state: status, timestamp: new Date().toISOString() },
    final,
  } as const;
}

function makeArtifactEvent() {
  return {
    kind: 'artifact' as const,
    taskId: 'task-1',
    artifact: { parts: [{ kind: 'text' as const, text: 'result' }] },
    append: false,
    lastChunk: true,
  };
}

describe('PushNotificationManager', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('') });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('register / unregister', () => {
    it('registers a push notification config', () => {
      const mgr = new PushNotificationManager();
      const config = makeConfig();

      mgr.register(config);

      expect(mgr.getConfig('task-1')).toBe(config);
    });

    it('unregisters a push notification config', () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig());
      mgr.unregister('task-1');

      expect(mgr.getConfig('task-1')).toBeUndefined();
    });

    it('listConfigs returns all configs when no taskId given', () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig({ taskId: 't1', url: 'https://a.com' }));
      mgr.register(makeConfig({ taskId: 't2', url: 'https://b.com' }));

      const list = mgr.listConfigs();
      expect(list).toHaveLength(2);
    });

    it('listConfigs returns config for a specific taskId', () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig({ taskId: 't1', url: 'https://a.com' }));
      mgr.register(makeConfig({ taskId: 't2', url: 'https://b.com' }));

      const list = mgr.listConfigs('t1');
      expect(list).toHaveLength(1);
      expect(list[0].url).toBe('https://a.com');
    });

    it('listConfigs returns empty array for unknown taskId', () => {
      const mgr = new PushNotificationManager();
      const list = mgr.listConfigs('unknown');
      expect(list).toEqual([]);
    });

    it('unregisterAll clears everything when no taskId given', () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig({ taskId: 't1' }));
      mgr.register(makeConfig({ taskId: 't2' }));
      mgr.unregisterAll();

      expect(mgr.listConfigs()).toHaveLength(0);
    });

    it('unregisterAll removes only the specified taskId', () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig({ taskId: 't1' }));
      mgr.register(makeConfig({ taskId: 't2' }));
      mgr.unregisterAll('t1');

      expect(mgr.listConfigs()).toHaveLength(1);
      expect(mgr.listConfigs()[0].taskId).toBe('t2');
    });
  });

  describe('notifyStatusUpdate', () => {
    it('sends a POST to the webhook URL', async () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig());

      const result = await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://example.com/webhook');
      expect(opts.method).toBe('POST');
    });

    it('returns false when no config is registered for the task', async () => {
      const mgr = new PushNotificationManager();
      const result = await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());
      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends status payload as JSON body', async () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig());

      const event = makeStatusEvent('working', false);
      await mgr.notifyStatusUpdate(makeTask({ id: 'task-1' }), event);

      const [, opts] = fetchSpy.mock.calls[0];
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({
        kind: 'status',
        taskId: 'task-1',
        status: event.status,
        final: false,
      });
      expect(opts.headers['Content-Type']).toBe('application/json');
    });

    it('deduplicates identical status notifications', async () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig());

      const task = makeTask({ id: 'task-1' });
      const event = makeStatusEvent('completed', true);

      await mgr.notifyStatusUpdate(task, event);
      await mgr.notifyStatusUpdate(task, event);

      // Second call is deduplicated — only one fetch call is made
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyArtifactUpdate', () => {
    it('sends a POST to the webhook URL', async () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig());

      const result = await mgr.notifyArtifactUpdate(makeTask(), makeArtifactEvent());

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://example.com/webhook');
    });

    it('returns false when no config is registered', async () => {
      const mgr = new PushNotificationManager();
      const result = await mgr.notifyArtifactUpdate(makeTask(), makeArtifactEvent());
      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends artifact payload as JSON body', async () => {
      const mgr = new PushNotificationManager();
      mgr.register(makeConfig());

      const event = makeArtifactEvent();
      await mgr.notifyArtifactUpdate(makeTask({ id: 'task-1' }), event);

      const [, opts] = fetchSpy.mock.calls[0];
      const body = JSON.parse(opts.body as string);
      expect(body).toEqual({
        kind: 'artifact',
        taskId: 'task-1',
        artifact: event.artifact,
        append: false,
        lastChunk: true,
      });
    });
  });

  describe('retry on failure', () => {
    it('retries on non-ok response', async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: false, status: 500, text: vi.fn().mockResolvedValue('err') })
        .mockResolvedValueOnce({ ok: true, text: vi.fn().mockResolvedValue('') });

      const mgr = new PushNotificationManager({ maxRetries: 3, retryDelayMs: 5 });
      mgr.register(makeConfig());

      const result = await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('returns false after exhausting retries', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('err'),
      });

      const mgr = new PushNotificationManager({ maxRetries: 2, retryDelayMs: 5 });
      mgr.register(makeConfig());

      const result = await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      expect(result).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('retries on fetch error (network failure)', async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ ok: true, text: vi.fn().mockResolvedValue('') });

      const mgr = new PushNotificationManager({ maxRetries: 3, retryDelayMs: 5 });
      mgr.register(makeConfig());

      const result = await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('uses exponential backoff delay', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('err'),
      });

      const mgr = new PushNotificationManager({ maxRetries: 4, retryDelayMs: 10 });
      mgr.register(makeConfig());

      const start = Date.now();
      await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());
      const elapsed = Date.now() - start;

      // Expected delays: 10 + 20 + 40 = 70ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(60);
    });
  });

  describe('dedup entries bounded', () => {
    it('evicts old entries when maxDedupEntries is exceeded', async () => {
      const mgr = new PushNotificationManager({
        maxDedupEntries: 3,
        maxRetries: 1,
        retryDelayMs: 5,
      });
      mgr.register(makeConfig());

      // Send 3 different statuses to fill the dedup map
      for (let i = 0; i < 3; i++) {
        await mgr.notifyStatusUpdate(makeTask({ id: 'task-1' }), {
          kind: 'status',
          status: { state: 'working', timestamp: `2025-01-01T00:00:0${i}Z` },
        });
      }

      // The dedup map should now be at capacity (3)
      // The 4th call triggers eviction of 50% (floor(1.5) = 1 entry)
      await mgr.notifyStatusUpdate(makeTask({ id: 'task-1' }), {
        kind: 'status',
        status: { state: 'working', timestamp: '2025-01-01T00:00:03Z' },
      });

      // Each call should result in a fetch (different dedup keys due to Math.random)
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('does not evict below maxDedupEntries threshold', async () => {
      // Use a low max to see eviction behavior
      const mgr = new PushNotificationManager({
        maxDedupEntries: 100,
        maxRetries: 1,
        retryDelayMs: 5,
      });
      mgr.register(makeConfig());

      for (let i = 0; i < 50; i++) {
        await mgr.notifyStatusUpdate(makeTask({ id: 'task-1' }), {
          kind: 'status',
          status: { state: 'working', timestamp: `2025-01-01T00:00:0${i}Z` },
        });
      }

      expect(fetchSpy).toHaveBeenCalledTimes(50);
    });
  });

  describe('missing taskId throws', () => {
    it('throws when config has no taskId', () => {
      const mgr = new PushNotificationManager();
      const config = makeConfig({ taskId: '' });

      expect(() => mgr.register(config)).toThrow('taskId is required');
    });
  });

  describe('auth header generation', () => {
    it('generates Bearer token header when token is present', async () => {
      const mgr = new PushNotificationManager({ maxRetries: 1, retryDelayMs: 5 });
      mgr.register(makeConfig({ token: 'secret-token' }));

      await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers.Authorization).toBe('Bearer secret-token');
    });

    it('generates apiKey header when authentication scheme is apiKey', async () => {
      const mgr = new PushNotificationManager({ maxRetries: 1, retryDelayMs: 5 });
      mgr.register(
        makeConfig({
          authentication: { scheme: 'apiKey', credentials: 'my-key' },
        }),
      );

      await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers['x-api-key']).toBe('my-key');
    });

    it('uses custom headerName for apiKey auth when provided', async () => {
      const mgr = new PushNotificationManager({ maxRetries: 1, retryDelayMs: 5 });
      mgr.register(
        makeConfig({
          authentication: { scheme: 'apiKey', credentials: 'my-key', headerName: 'X-Custom-Auth' },
        }),
      );

      await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers['X-Custom-Auth']).toBe('my-key');
    });

    it('prefers token over authentication object', async () => {
      const mgr = new PushNotificationManager({ maxRetries: 1, retryDelayMs: 5 });
      mgr.register(
        makeConfig({
          token: 'token-wins',
          authentication: { scheme: 'apiKey', credentials: 'key-loses' },
        }),
      );

      await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers.Authorization).toBe('Bearer token-wins');
      expect(opts.headers['x-api-key']).toBeUndefined();
    });

    it('sends no auth header when neither token nor authentication is configured', async () => {
      const mgr = new PushNotificationManager({ maxRetries: 1, retryDelayMs: 5 });
      mgr.register(makeConfig({ token: undefined }));

      await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers.Authorization).toBeUndefined();
      expect(opts.headers['x-api-key']).toBeUndefined();
    });
  });

  describe('User-Agent header', () => {
    it('sends a2a User-Agent header', async () => {
      const mgr = new PushNotificationManager({ maxRetries: 1, retryDelayMs: 5 });
      mgr.register(makeConfig());

      await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers['User-Agent']).toBe('a2a-reference-push-notification/0.1.0');
    });
  });

  describe('config defaults', () => {
    it('uses default logger when none provided', () => {
      const mgr = new PushNotificationManager();
      expect(mgr).toBeDefined();
    });

    it('uses default maxRetries when not provided', async () => {
      fetchSpy.mockRejectedValue(new Error('fail'));
      const mgr = new PushNotificationManager({ retryDelayMs: 5 });
      mgr.register(makeConfig());

      await mgr.notifyStatusUpdate(makeTask(), makeStatusEvent());

      // Default maxRetries = 3, fetch should be called 3 times (attempt 0, 1, 2)
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });
});
