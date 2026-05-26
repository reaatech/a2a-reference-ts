export type { Logger } from 'pino';
export { createLogger, withCorrelationId, defaultLogger } from './logger.js';
export type { LoggerOptions } from './logger.js';
export {
  setTelemetryProvider,
  getTelemetryProvider,
  getTracer,
  getMeter,
  createTaskCounter,
  createTaskDurationHistogram,
  withTaskSpan,
  NoopSpan,
} from './telemetry.js';
export type {
  TelemetryProvider,
  TelemetryTracer,
  TelemetrySpan,
  TelemetryMeter,
  TelemetryCounter,
  TelemetryHistogram,
  TelemetryGauge,
} from './telemetry.js';
