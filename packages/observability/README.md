# @reaatech/a2a-reference-observability

[![npm version](https://img.shields.io/npm/v/@reaatech/a2a-reference-observability.svg)](https://www.npmjs.com/package/@reaatech/a2a-reference-observability)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/reaatech/a2a-reference-ts/ci.yml?branch=main&label=CI)](https://github.com/reaatech/a2a-reference-ts/actions/workflows/ci.yml)

> **Status:** Pre-1.0 — APIs may change in minor versions. Pin to a specific version in production.

Structured logging and tracing utilities for A2A agents, built on [Pino](https://github.com/pinojs/pino) (v9). Provides a zero-config default logger and factory functions for creating context-aware loggers with correlation ID propagation.

## Installation

```bash
npm install @reaatech/a2a-reference-observability
# or
pnpm add @reaatech/a2a-reference-observability
```

## Feature Overview

- **Structured JSON logging** — Pino-powered, fast and low-overhead
- **Automatic pretty-printing** — human-readable output in development, raw JSON in production
- **Correlation ID propagation** — trace requests across async boundaries via child loggers
- **Named loggers** — identify which component emitted each log line
- **Pre-configured default** — import and use immediately with sensible defaults

## Quick Start

```typescript
import { defaultLogger, createLogger, withCorrelationId } from "@reaatech/a2a-reference-observability";

// Use the pre-configured default logger
defaultLogger.info("Agent started");
defaultLogger.warn({ port: 3000 }, "Server is listening");

// Create a custom logger
const logger = createLogger({
  name: "my-agent",
  level: "debug",
});

logger.debug({ requestId: "abc123" }, "Processing request");

// Propagate correlation ID for request tracing
const requestLogger = withCorrelationId(logger, "req-abc123");
requestLogger.info("Starting task execution");
// → {"name":"my-agent","level":"INFO","correlationId":"req-abc123","msg":"Starting task execution"}
```

## API Reference

### `defaultLogger`

A ready-to-use Pino `Logger` instance configured with defaults (`name: "a2a"`, `level: "info"`). Import and log immediately without any setup.

```typescript
import { defaultLogger } from "@reaatech/a2a-reference-observability";

defaultLogger.info("Ready");
defaultLogger.error({ err: new Error("boom") }, "Something went wrong");
```

### `createLogger(options?: LoggerOptions): Logger`

Creates a configured Pino logger instance.

```typescript
const logger = createLogger({
  name: "task-executor",
  level: "trace",
  correlationId: "corr-456",
});
```

#### `LoggerOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `"a2a"` | Logger name, included in every log line |
| `level` | `string` | `"info"` | Minimum log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `correlationId` | `string` | — | Optional ID propagated to child loggers for request tracing |

#### Transport Behavior

- **Development** (`NODE_ENV !== "production"`): enables `pino-pretty` with colorized output
- **Production** (`NODE_ENV === "production"`): raw JSON output for log aggregators (Datadog, CloudWatch, ELK, etc.)

### `withCorrelationId(logger: Logger, correlationId: string): Logger`

Wraps an existing logger with a `correlationId` binding, returning a child logger. All subsequent log entries from the child automatically include the correlation ID.

```typescript
async function handleRequest(req: Request) {
  const correlationId = req.headers["x-request-id"] ?? crypto.randomUUID();
  const logger = withCorrelationId(defaultLogger, correlationId);

  logger.info("Request received");

  // Logs from nested calls also carry the correlation ID
  await processTask(logger);
}
```

This is useful for:
- Tracing a request across service boundaries
- Associating logs from async work with the originating request
- Debugging distributed workflows

### `Logger` (type)

Re-exported Pino `Logger` type for use in type annotations:

```typescript
import type { Logger } from "@reaatech/a2a-reference-observability";

class MyService {
  constructor(private logger: Logger) {}
}
```

## Usage Patterns

### Structured Context

Pino encourages attaching structured data as the first argument:

```typescript
logger.info({ taskId: "task-123", state: "working" }, "Task state changed");
// → {"name":"a2a","level":"INFO","taskId":"task-123","state":"working","msg":"Task state changed"}
```

### Error Logging

Pass errors via the `err` key for automatic stack trace serialization:

```typescript
try {
  await riskyOperation();
} catch (err) {
  logger.error({ err, taskId: "task-123" }, "Task execution failed");
}
```

### Child Loggers for Component Isolation

```typescript
const baseLogger = createLogger({ name: "agent" });

const httpLogger = baseLogger.child({ component: "http" });
const taskLogger = baseLogger.child({ component: "task-executor" });

httpLogger.info("Server started");
// → {"name":"agent","component":"http","level":"INFO","msg":"Server started"}

taskLogger.info("Executing task");
// → {"name":"agent","component":"task-executor","level":"INFO","msg":"Executing task"}
```

## Integration with the Server

The `@reaatech/a2a-reference-mcp-bridge` package uses this package for structured logging:

```typescript
import { createLogger } from "@reaatech/a2a-reference-observability";

const logger = createLogger({ name: "mcp-bridge", level: "info" });
logger.info({ a2aAgentUrl: url }, "Initializing A2A-as-MCP bridge");
```

## Related Packages

- [`@reaatech/a2a-reference-server`](https://www.npmjs.com/package/@reaatech/a2a-reference-server) — A2A server framework
- [`@reaatech/a2a-reference-mcp-bridge`](https://www.npmjs.com/package/@reaatech/a2a-reference-mcp-bridge) — A2A ↔ MCP bridge (uses this package)

## License

[MIT](https://github.com/reaatech/a2a-reference-ts/blob/main/LICENSE)
