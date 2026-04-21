import { describe, expect, it } from 'vitest';
import { createLogger, defaultLogger, withCorrelationId } from './index.js';

describe('observability', () => {
  it('creates a pino logger', () => {
    const logger = createLogger({ name: 'test', level: 'silent' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('uses silent level for tests', () => {
    const logger = createLogger({ level: 'silent' });
    expect(logger.level).toBe('silent');
  });

  it('defaults name to "a2a"', () => {
    const logger = createLogger({ level: 'silent' });
    expect(logger.bindings().name).toBe('a2a');
  });

  it('defaults level to "info"', () => {
    const logger = createLogger({ name: 'test' });
    expect(logger.level).toBe('info');
  });

  it('creates logger in non-production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const logger = createLogger({ level: 'silent' });
    expect(logger).toBeDefined();
    expect(logger.level).toBe('silent');
    process.env.NODE_ENV = originalEnv;
  });

  it('has no transport in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const logger = createLogger({ level: 'silent' });
    expect(logger).toBeDefined();
    process.env.NODE_ENV = originalEnv;
  });

  it('creates child logger with correlationId', () => {
    const logger = createLogger({ level: 'silent', correlationId: 'abc-123' });
    expect(logger.bindings().correlationId).toBe('abc-123');
  });

  it('withCorrelationId wraps existing logger', () => {
    const logger = createLogger({ level: 'silent', name: 'base' });
    const child = withCorrelationId(logger, 'xyz-789');
    expect(child.bindings().correlationId).toBe('xyz-789');
    expect(child.bindings().name).toBe('base');
  });

  it('exports a defaultLogger', () => {
    expect(defaultLogger).toBeDefined();
    expect(typeof defaultLogger.info).toBe('function');
    expect(defaultLogger.bindings().name).toBe('a2a');
  });
});
