# @reaatech/a2a-reference-observability

Structured logging, tracing, and metrics for A2A agents.

## Logging

Pino-based structured logging with correlation IDs:

```ts
import { createLogger, withCorrelationId, defaultLogger } from '@reaatech/a2a-reference-observability';

const logger = createLogger({ name: 'my-agent', level: 'info' });
logger.info({ taskId: 'abc' }, 'Task created');

// With correlation ID
const traced = withCorrelationId(logger, 'corr-123');
traced.info('Processing');
```

## Telemetry

The package provides OpenTelemetry abstractions with no-op defaults. To instrument your agent, provide a custom `TelemetryProvider`:

```ts
import { setTelemetryProvider, getTracer, getMeter } from '@reaatech/a2a-reference-observability';
import type { TelemetryProvider, TelemetrySpan, TelemetryTracer, TelemetryMeter } from '@reaatech/a2a-reference-observability';

// Use no-ops by default (nothing to configure)
const tracer = getTracer('my-agent');
const meter = getMeter('my-agent');

// Create metrics
const taskCounter = meter.createCounter('a2a.tasks.total', { description: 'Total tasks' });
const durationHistogram = meter.createHistogram('a2a.tasks.duration', { unit: 'ms' });

// Trace operations
import { withTaskSpan } from '@reaatech/a2a-reference-observability';

await withTaskSpan(tracer, taskId, 'execute', async (span) => {
  span.setAttribute('skill.id', 'echo');
  // your logic here
});
```

### Custom Provider

```ts
import { setTelemetryProvider, type TelemetryProvider } from '@reaatech/a2a-reference-observability';

const myProvider: TelemetryProvider = {
  getTracer(name, version) { /* return OpenTelemetry tracer */ },
  getMeter(name, version) { /* return OpenTelemetry meter */ },
};

setTelemetryProvider(myProvider);
```
