import { defaultLogger } from '@reaatech/a2a-reference-observability';
import type { TaskStore } from '@reaatech/a2a-reference-persistence';
import { z } from 'zod';

export const HealthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'unhealthy']),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['ok', 'degraded', 'unhealthy']),
      message: z.string().optional(),
    }),
  ),
});

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  checks: {
    name: string;
    status: 'ok' | 'degraded' | 'unhealthy';
    message?: string;
  }[];
}

export interface HealthCheckDependencies {
  taskStore?: TaskStore;
  version?: string;
  startTime?: number;
  checks?: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  check: () => Promise<{ status: 'ok' | 'degraded' | 'unhealthy'; message?: string }>;
}

export async function createHealthStatus(deps: HealthCheckDependencies): Promise<HealthStatus> {
  const checks: HealthStatus['checks'] = [];

  if (deps.taskStore) {
    try {
      const result = await deps.taskStore.list({ pageSize: 1 });
      if (result && Array.isArray(result.tasks)) {
        checks.push({ name: 'task-store', status: 'ok' });
      } else {
        checks.push({ name: 'task-store', status: 'degraded', message: 'unexpected response' });
      }
    } catch (err) {
      checks.push({
        name: 'task-store',
        status: 'unhealthy',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  if (deps.checks) {
    for (const customCheck of deps.checks) {
      try {
        const result = await customCheck.check();
        checks.push({ name: customCheck.name, status: result.status, message: result.message });
      } catch (err) {
        checks.push({
          name: customCheck.name,
          status: 'unhealthy',
          message: err instanceof Error ? err.message : 'check threw',
        });
      }
    }
  }

  const hasUnhealthy = checks.some((c) => c.status === 'unhealthy');
  const hasDegraded = checks.some((c) => c.status === 'degraded');

  const healthStatus: HealthStatus = {
    status: hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'ok',
    version: deps.version ?? '0.0.0',
    uptime: Math.floor((Date.now() - (deps.startTime ?? Date.now())) / 1000),
    timestamp: new Date().toISOString(),
    checks,
  };

  const validated = HealthStatusSchema.safeParse(healthStatus);
  if (!validated.success) {
    defaultLogger.error({ err: validated.error }, 'health status validation failed');
  }
  return validated.success ? validated.data : healthStatus;
}
