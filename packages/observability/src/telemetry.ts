export interface TelemetrySpan {
  end(): void;
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  addEvent(name: string, attrs?: Record<string, string | number | boolean>): void;
  setStatus(status: { code: 'ok' | 'error'; message?: string }): void;
  isRecording(): boolean;
}

export interface TelemetryTracer {
  startSpan(
    name: string,
    options?: {
      attributes?: Record<string, string | number | boolean>;
      kind?: string;
    },
  ): TelemetrySpan;
  startActiveSpan<F extends (span: TelemetrySpan) => Promise<unknown>>(
    name: string,
    fn: F,
  ): Promise<ReturnType<F>>;
  startActiveSpan<F extends (span: TelemetrySpan) => Promise<unknown>>(
    name: string,
    options: {
      attributes?: Record<string, string | number | boolean>;
      kind?: string;
    },
    fn: F,
  ): Promise<ReturnType<F>>;
}

export interface TelemetryMeter {
  createCounter(name: string, options?: { description?: string; unit?: string }): TelemetryCounter;
  createHistogram(
    name: string,
    options?: { description?: string; unit?: string },
  ): TelemetryHistogram;
  createGauge(name: string, options?: { description?: string; unit?: string }): TelemetryGauge;
}

export interface TelemetryCounter {
  add(value: number, attrs?: Record<string, string>): void;
}

export interface TelemetryHistogram {
  record(value: number, attrs?: Record<string, string>): void;
}

export interface TelemetryGauge {
  record(value: number, attrs?: Record<string, string>): void;
}

export interface TelemetryProvider {
  getTracer(name?: string, version?: string): TelemetryTracer;
  getMeter(name?: string, version?: string): TelemetryMeter;
  shutdown?(): Promise<void>;
}

export class NoopSpan implements TelemetrySpan {
  end(): void {}
  setAttribute(_key: string, _value: string | number | boolean): void {}
  setAttributes(_attrs: Record<string, string | number | boolean>): void {}
  addEvent(_name: string, _attrs?: Record<string, string | number | boolean>): void {}
  setStatus(_status: { code: 'ok' | 'error'; message?: string }): void {}
  isRecording(): boolean {
    return false;
  }
}

class NoopTracer implements TelemetryTracer {
  private noopSpan = new NoopSpan();

  startSpan(
    _name: string,
    _options?: {
      attributes?: Record<string, string | number | boolean>;
      kind?: string;
    },
  ): TelemetrySpan {
    return this.noopSpan;
  }

  async startActiveSpan<F extends (span: TelemetrySpan) => Promise<unknown>>(
    _name: string,
    _optionsOrFn:
      | {
          attributes?: Record<string, string | number | boolean>;
          kind?: string;
        }
      | F,
    _fn?: F,
  ): Promise<ReturnType<F>> {
    const fn = typeof _optionsOrFn === 'function' ? _optionsOrFn : (_fn as F);
    const options = typeof _optionsOrFn === 'function' ? {} : _optionsOrFn;
    const span = this.startSpan(_name, options);
    try {
      const result = await fn(span);
      return result as ReturnType<F>;
    } finally {
      span.end();
    }
  }
}

class NoopCounter implements TelemetryCounter {
  add(_value: number, _attrs?: Record<string, string>): void {}
}

class NoopHistogram implements TelemetryHistogram {
  record(_value: number, _attrs?: Record<string, string>): void {}
}

class NoopGauge implements TelemetryGauge {
  record(_value: number, _attrs?: Record<string, string>): void {}
}

class NoopMeter implements TelemetryMeter {
  private noopCounter = new NoopCounter();
  private noopHistogram = new NoopHistogram();
  private noopGauge = new NoopGauge();

  createCounter(
    _name: string,
    _options?: { description?: string; unit?: string },
  ): TelemetryCounter {
    return this.noopCounter;
  }
  createHistogram(
    _name: string,
    _options?: { description?: string; unit?: string },
  ): TelemetryHistogram {
    return this.noopHistogram;
  }
  createGauge(_name: string, _options?: { description?: string; unit?: string }): TelemetryGauge {
    return this.noopGauge;
  }
}

class NoopProvider implements TelemetryProvider {
  private noopTracer = new NoopTracer();
  private noopMeter = new NoopMeter();

  getTracer(_name?: string, _version?: string): TelemetryTracer {
    return this.noopTracer;
  }
  getMeter(_name?: string, _version?: string): TelemetryMeter {
    return this.noopMeter;
  }
}

/**
 * Global mutable state holding the active {@link TelemetryProvider}.
 * This is an intentional pattern matching the OpenTelemetry SDK's
 * `trace.setGlobalTracerProvider()` / `metrics.setGlobalMeterProvider()`.
 */
let globalProvider: TelemetryProvider = new NoopProvider();

let isShuttingDown = false;

export function setTelemetryProvider(provider: TelemetryProvider): void {
  const previousProvider = globalProvider;
  if (previousProvider && !isShuttingDown) {
    isShuttingDown = true;
    previousProvider
      .shutdown?.()
      ?.catch((_err) => {
        // intentionally fire-and-forget
      })
      .finally(() => {
        isShuttingDown = false;
      });
  }
  globalProvider = provider;
}

export function getTelemetryProvider(): TelemetryProvider {
  return globalProvider;
}

export function getTracer(name?: string, version?: string): TelemetryTracer {
  return globalProvider.getTracer(name, version);
}

export function getMeter(name?: string, version?: string): TelemetryMeter {
  return globalProvider.getMeter(name, version);
}

export function createTaskCounter(meter?: TelemetryMeter): TelemetryCounter {
  const m = meter ?? getMeter('a2a-reference');
  return m.createCounter('a2a.tasks.total', {
    description: 'Total number of A2A tasks processed',
    unit: '1',
  });
}

export function createTaskDurationHistogram(meter?: TelemetryMeter): TelemetryHistogram {
  const m = meter ?? getMeter('a2a-reference');
  return m.createHistogram('a2a.tasks.duration', {
    description: 'Duration of A2A task execution',
    unit: 'ms',
  });
}

export async function withTaskSpan<T>(
  tracer: TelemetryTracer,
  taskId: string,
  operation: string,
  fn: (span: TelemetrySpan) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `a2a.task.${operation}`,
    {
      attributes: {
        'a2a.task.id': taskId,
        'a2a.operation': operation,
      },
      kind: 'internal',
    },
    fn,
  );
}
