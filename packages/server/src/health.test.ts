import { describe, expect, it, vi } from 'vitest';
import { createHealthStatus } from './health.js';

describe('createHealthStatus', () => {
  it('returns ok when taskStore responds with a valid list', async () => {
    const mockStore = {
      list: vi.fn().mockResolvedValue({ tasks: [], nextPageToken: '', totalSize: 0 }),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({ taskStore: mockStore });

    expect(result.status).toBe('ok');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ name: 'task-store', status: 'ok' });
  });

  it('returns degraded when taskStore returns unexpected response', async () => {
    const mockStore = {
      list: vi.fn().mockResolvedValue({ tasks: null }),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({ taskStore: mockStore });

    expect(result.status).toBe('degraded');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      name: 'task-store',
      status: 'degraded',
      message: 'unexpected response',
    });
  });

  it('returns degraded when taskStore returns a falsy result', async () => {
    const mockStore = {
      list: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({ taskStore: mockStore });

    expect(result.status).toBe('degraded');
    expect(result.checks[0]).toMatchObject({ name: 'task-store', status: 'degraded' });
  });

  it('returns degraded when taskStore returns empty object without tasks', async () => {
    const mockStore = {
      list: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({ taskStore: mockStore });

    expect(result.status).toBe('degraded');
    expect(result.checks[0]).toMatchObject({ name: 'task-store', status: 'degraded' });
  });

  it('returns unhealthy when taskStore throws', async () => {
    const mockStore = {
      list: vi.fn().mockRejectedValue(new Error('connection refused')),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({ taskStore: mockStore });

    expect(result.status).toBe('unhealthy');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      name: 'task-store',
      status: 'unhealthy',
      message: 'connection refused',
    });
  });

  it('includes error message when taskStore throws a non-Error', async () => {
    const mockStore = {
      list: vi.fn().mockRejectedValue('something broke'),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({ taskStore: mockStore });

    expect(result.status).toBe('unhealthy');
    expect(result.checks[0].message).toBe('unknown error');
  });

  it('skips taskStore check when no taskStore is provided', async () => {
    const result = await createHealthStatus({});

    expect(result.checks).toHaveLength(0);
    expect(result.status).toBe('ok');
  });

  it('respects custom checks that return ok', async () => {
    const mockStore = {
      list: vi.fn().mockResolvedValue({ tasks: [], nextPageToken: '', totalSize: 0 }),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({
      taskStore: mockStore,
      checks: [
        {
          name: 'db-connections',
          check: async () => ({ status: 'ok' as const }),
        },
      ],
    });

    expect(result.checks).toHaveLength(2);
    expect(result.checks[1]).toMatchObject({ name: 'db-connections', status: 'ok' });
    expect(result.status).toBe('ok');
  });

  it('custom checks can elevate status to degraded', async () => {
    const mockStore = {
      list: vi.fn().mockResolvedValue({ tasks: [], nextPageToken: '', totalSize: 0 }),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({
      taskStore: mockStore,
      checks: [
        {
          name: 'slow-db',
          check: async () => ({ status: 'degraded' as const, message: 'high latency' }),
        },
      ],
    });

    expect(result.status).toBe('degraded');
    expect(result.checks[1]).toMatchObject({
      name: 'slow-db',
      status: 'degraded',
      message: 'high latency',
    });
  });

  it('custom checks can elevate status to unhealthy', async () => {
    const mockStore = {
      list: vi.fn().mockResolvedValue({ tasks: [], nextPageToken: '', totalSize: 0 }),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({
      taskStore: mockStore,
      checks: [
        {
          name: 'critical-service',
          check: async () => ({ status: 'unhealthy' as const, message: 'down' }),
        },
      ],
    });

    expect(result.status).toBe('unhealthy');
    expect(result.checks[1]).toMatchObject({
      name: 'critical-service',
      status: 'unhealthy',
      message: 'down',
    });
  });

  it('catches exceptions thrown by custom checks', async () => {
    const mockStore = {
      list: vi.fn().mockResolvedValue({ tasks: [], nextPageToken: '', totalSize: 0 }),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      addHistory: vi.fn(),
      addArtifact: vi.fn(),
      updateStatus: vi.fn(),
    };

    const result = await createHealthStatus({
      taskStore: mockStore,
      checks: [
        {
          name: 'flaky-service',
          check: async () => {
            throw new Error('timeout');
          },
        },
      ],
    });

    expect(result.checks[1]).toMatchObject({
      name: 'flaky-service',
      status: 'unhealthy',
      message: 'timeout',
    });
    expect(result.status).toBe('unhealthy');
  });

  it('includes version and uptime fields', async () => {
    const startTime = Date.now();
    const result = await createHealthStatus({ version: '1.2.3', startTime });

    expect(result.version).toBe('1.2.3');
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.uptime).toBeLessThan(10);
  });

  it('falls back to default version 0.0.0', async () => {
    const result = await createHealthStatus({});

    expect(result.version).toBe('0.0.0');
  });

  it('includes an ISO timestamp string', async () => {
    const result = await createHealthStatus({});

    expect(result.timestamp).toBeDefined();
    expect(() => new Date(result.timestamp)).not.toThrow();
  });
});
