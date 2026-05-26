import { type Logger, type TransportMultiOptions, type TransportSingleOptions, pino } from 'pino';

export type { Logger };

export interface LoggerOptions {
  name?: string;
  level?: string;
  correlationId?: string;
  /**
   * Pino transport configuration. When provided, it is passed directly to
   * `pino({ transport })`. If omitted and `NODE_ENV !== 'production'`, the
   * default pino-pretty transport is used.
   *
   * **Serverless/edge limitation:** The default pino-pretty transport uses
   * `pino.transport()` which spawns a worker thread. This will fail in
   * environments that do not support worker threads (Cloudflare Workers,
   * Deno Deploy, some AWS Lambda configurations). For those runtimes set
   * `NODE_ENV=production` or pass `{ transport: undefined }` and pipe the
   * raw JSON output through a separate prettifier process.
   */
  transport?: TransportSingleOptions | TransportMultiOptions | undefined;
}

export function createLogger(options?: LoggerOptions): Logger {
  const transport =
    'transport' in (options ?? {})
      ? options?.transport
      : process.env.NODE_ENV !== 'production'
        ? ({
            target: 'pino-pretty',
            options: { colorize: true },
          } as TransportSingleOptions)
        : undefined;

  const logger = pino({
    name: options?.name ?? 'a2a',
    level: options?.level ?? 'info',
    transport,
  });

  if (options?.correlationId) {
    return logger.child({ correlationId: options.correlationId });
  }

  return logger;
}

export function withCorrelationId(logger: Logger, correlationId: string): Logger {
  return logger.child({ correlationId });
}

export const defaultLogger: Logger = createLogger();
