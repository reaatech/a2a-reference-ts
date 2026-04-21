import { describe, expect, it } from 'vitest';
import { DataPartSchema, FilePartSchema, PartSchema, TextPartSchema } from './part.js';

describe('Part schemas', () => {
  it('validates text part', () => {
    const result = TextPartSchema.safeParse({ kind: 'text', text: 'hello' });
    expect(result.success).toBe(true);
  });

  it('validates file part', () => {
    const result = FilePartSchema.safeParse({
      kind: 'file',
      file: { name: 'test.txt', mimeType: 'text/plain', bytes: 'abc' },
    });
    expect(result.success).toBe(true);
  });

  it('validates data part', () => {
    const result = DataPartSchema.safeParse({
      kind: 'data',
      data: { key: 'value' },
    });
    expect(result.success).toBe(true);
  });

  it('validates union part', () => {
    expect(PartSchema.safeParse({ kind: 'text', text: 'hi' }).success).toBe(true);
    expect(PartSchema.safeParse({ kind: 'file', file: {} }).success).toBe(true);
    expect(PartSchema.safeParse({ kind: 'data', data: {} }).success).toBe(true);
  });

  it('rejects invalid part kind', () => {
    expect(PartSchema.safeParse({ kind: 'unknown' }).success).toBe(false);
  });
});
