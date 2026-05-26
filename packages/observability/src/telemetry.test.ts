import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NoopSpan,
  createTaskCounter,
  createTaskDurationHistogram,
  getMeter,
  getTelemetryProvider,
  getTracer,
  setTelemetryProvider,
  withTaskSpan,
} from './index.js';
import type { TelemetryMeter, TelemetryProvider, TelemetrySpan, TelemetryTracer } from './index.js';

describe('NoopSpan', () => {
  it('returns false from isRecording', () => {
    const span = new NoopSpan();
    expect(span.isRecording()).toBe(false);
  });

  it('does not throw on any method', () => {
    const span = new NoopSpan();
    expect(() => {
      span.end();
      span.setAttribute('key', 'value');
      span.setAttributes({ a: 1, b: 'two' });
      span.addEvent('event', { detail: 'info' });
      span.setStatus({ code: 'ok' });
    }).not.toThrow();
  });
});

describe('NoopProvider', () => {
  let originalProvider: TelemetryProvider;

  beforeEach(() => {
    originalProvider = getTelemetryProvider();
  });

  afterEach(() => {
    setTelemetryProvider(originalProvider);
  });

  it('is used as the default provider', () => {
    const tracer = getTracer();
    const span = tracer.startSpan('test');
    expect(span.isRecording()).toBe(false);
  });

  it('getTracer returns a tracer', () => {
    const tracer = getTracer();
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
  });

  it('getMeter returns a meter', () => {
    const meter = getMeter();
    expect(meter).toBeDefined();
    expect(typeof meter.createCounter).toBe('function');
  });

  it('startActiveSpan invokes the callback and ends the span', async () => {
    const tracer = getTracer();
    const spy = vi.fn();

    await tracer.startActiveSpan('test', async (span) => {
      expect(span.isRecording()).toBe(false);
      span.end();
      spy();
      return 'done';
    });

    expect(spy).toHaveBeenCalledOnce();
  });

  it('startActiveSpan works with options overload', async () => {
    const tracer = getTracer();

    const result = await tracer.startActiveSpan(
      'test',
      { attributes: { key: 'val' }, kind: 'internal' },
      async (_span) => 'ok',
    );

    expect(result).toBe('ok');
  });
});

describe('setTelemetryProvider', () => {
  let originalProvider: TelemetryProvider;

  beforeEach(() => {
    originalProvider = getTelemetryProvider();
  });

  afterEach(() => {
    setTelemetryProvider(originalProvider);
  });

  it('replaces the global provider', () => {
    const mockTracer: TelemetryTracer = {
      startSpan() {
        return new NoopSpan();
      },
      async startActiveSpan(_name: string, ...args: unknown[]) {
        const fn = args.length === 2 ? args[1] : args[0];
        const result = await (fn as (span: TelemetrySpan) => Promise<unknown>)(new NoopSpan());
        return result;
      },
    };
    const mockMeter: TelemetryMeter = {
      createCounter() {
        return { add() {} };
      },
      createHistogram() {
        return { record() {} };
      },
      createGauge() {
        return { record() {} };
      },
    };
    const provider: TelemetryProvider = {
      getTracer() {
        return mockTracer;
      },
      getMeter() {
        return mockMeter;
      },
    };

    setTelemetryProvider(provider);

    expect(getTelemetryProvider()).toBe(provider);
    expect(getTracer()).toBe(mockTracer);
    expect(getMeter()).toBe(mockMeter);
  });
});

describe('getTracer', () => {
  let originalProvider: TelemetryProvider;

  beforeEach(() => {
    originalProvider = getTelemetryProvider();
  });

  afterEach(() => {
    setTelemetryProvider(originalProvider);
  });

  it('passes name and version to provider', () => {
    const spy = vi.fn<(...args: unknown[]) => ReturnType<TelemetryProvider['getTracer']>>();
    const provider: TelemetryProvider = {
      getTracer: spy,
      getMeter() {
        return {
          createCounter() {
            return { add() {} };
          },
          createHistogram() {
            return { record() {} };
          },
          createGauge() {
            return { record() {} };
          },
        };
      },
    };
    setTelemetryProvider(provider);

    getTracer('my-tracer', '1.0.0');
    expect(spy).toHaveBeenCalledWith('my-tracer', '1.0.0');
  });
});

describe('getMeter', () => {
  let originalProvider: TelemetryProvider;

  beforeEach(() => {
    originalProvider = getTelemetryProvider();
  });

  afterEach(() => {
    setTelemetryProvider(originalProvider);
  });

  it('passes name and version to provider', () => {
    const spy = vi.fn<(...args: unknown[]) => ReturnType<TelemetryProvider['getMeter']>>();
    const provider: TelemetryProvider = {
      getTracer() {
        return {
          startSpan() {
            return new NoopSpan();
          },
          async startActiveSpan(_name: string, ...args: unknown[]) {
            const fn = args.length === 2 ? args[1] : args[0];
            return (fn as (span: TelemetrySpan) => Promise<unknown>)(new NoopSpan());
          },
        };
      },
      getMeter: spy,
    };
    setTelemetryProvider(provider);

    getMeter('my-meter', '2.0.0');
    expect(spy).toHaveBeenCalledWith('my-meter', '2.0.0');
  });
});

describe('createTaskCounter', () => {
  it('returns a counter from the default meter', () => {
    const counter = createTaskCounter();
    expect(counter).toBeDefined();
    expect(typeof counter.add).toBe('function');
  });

  it('uses a provided meter instead of the default', () => {
    const addSpy = vi.fn();
    const customMeter: TelemetryMeter = {
      createCounter() {
        return { add: addSpy };
      },
      createHistogram() {
        return { record() {} };
      },
      createGauge() {
        return { record() {} };
      },
    };

    const counter = createTaskCounter(customMeter);
    counter.add(1);

    expect(addSpy).toHaveBeenCalledWith(1);
  });

  it('counter.add does not throw', () => {
    const counter = createTaskCounter();
    expect(() => counter.add(1)).not.toThrow();
  });
});

describe('createTaskDurationHistogram', () => {
  it('returns a histogram from the default meter', () => {
    const histogram = createTaskDurationHistogram();
    expect(histogram).toBeDefined();
    expect(typeof histogram.record).toBe('function');
  });

  it('uses a provided meter instead of the default', () => {
    const recordSpy = vi.fn();
    const customMeter: TelemetryMeter = {
      createCounter() {
        return { add() {} };
      },
      createHistogram() {
        return { record: recordSpy };
      },
      createGauge() {
        return { record() {} };
      },
    };

    const histogram = createTaskDurationHistogram(customMeter);
    histogram.record(100);

    expect(recordSpy).toHaveBeenCalledWith(100);
  });

  it('histogram.record does not throw', () => {
    const histogram = createTaskDurationHistogram();
    expect(() => histogram.record(100)).not.toThrow();
  });
});

describe('withTaskSpan', () => {
  it('starts and ends a span around the callback', async () => {
    const endSpy = vi.fn();
    const startActiveSpanSpy = vi.fn(
      async (_name: string, _options: unknown, fn: (span: TelemetrySpan) => Promise<unknown>) => {
        const span = new NoopSpan();
        span.end = endSpy;
        const result = await fn(span);
        span.end();
        return result;
      },
    );
    const tracer: TelemetryTracer = {
      startSpan() {
        return new NoopSpan();
      },
      startActiveSpan: startActiveSpanSpy as unknown as TelemetryTracer['startActiveSpan'],
    };

    const result = await withTaskSpan(tracer, 'task-1', 'process', async (span) => {
      return span.isRecording();
    });

    expect(result).toBe(false);
    expect(endSpy).toHaveBeenCalledOnce();
  });

  it('includes task attributes in the span options', async () => {
    const startActiveSpanSpy = vi.fn(
      async (_name: string, _options: unknown, fn: (span: TelemetrySpan) => Promise<unknown>) => {
        return fn(new NoopSpan());
      },
    );
    const tracer: TelemetryTracer = {
      startSpan() {
        return new NoopSpan();
      },
      startActiveSpan: startActiveSpanSpy as unknown as TelemetryTracer['startActiveSpan'],
    };

    await withTaskSpan(tracer, 'task-42', 'compute', async () => 'done');

    expect(startActiveSpanSpy).toHaveBeenCalledWith(
      'a2a.task.compute',
      {
        attributes: {
          'a2a.task.id': 'task-42',
          'a2a.operation': 'compute',
        },
        kind: 'internal',
      },
      expect.any(Function),
    );
  });
});
