import { type Logger, pino } from 'pino';

export type { Logger };

export interface LoggerOptions {
  name?: string;
  level?: string;
  correlationId?: string;
}

export function createLogger(options?: LoggerOptions): Logger {
  const logger = pino({
    name: options?.name ?? 'a2a',
    level: options?.level ?? 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
            },
          }
        : undefined,
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
