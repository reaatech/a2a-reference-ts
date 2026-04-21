import { describe, expect, it } from 'vitest';
import { ApiKeyStrategy } from './api-key.js';

describe('ApiKeyStrategy', () => {
  it('authenticates with a valid key', async () => {
    const strategy = new ApiKeyStrategy({ keys: new Set(['secret-123']) });
    const result = await strategy.authenticate({
      headers: { 'x-api-key': 'secret-123' },
    });
    expect(result.authenticated).toBe(true);
    expect(result.principal).toContain('api-key:');
  });

  it('rejects missing key', async () => {
    const strategy = new ApiKeyStrategy({ keys: new Set(['secret-123']) });
    const result = await strategy.authenticate({ headers: {} });
    expect(result.authenticated).toBe(false);
    expect(result.reason).toBe('missing api key');
  });

  it('rejects invalid key', async () => {
    const strategy = new ApiKeyStrategy({ keys: new Set(['secret-123']) });
    const result = await strategy.authenticate({
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(result.authenticated).toBe(false);
    expect(result.reason).toBe('invalid api key');
  });

  it('uses custom header name', async () => {
    const strategy = new ApiKeyStrategy({
      keys: new Set(['secret-123']),
      headerName: 'x-custom-key',
    });
    const result = await strategy.authenticate({
      headers: { 'x-custom-key': 'secret-123' },
    });
    expect(result.authenticated).toBe(true);
  });

  it('handles array header values', async () => {
    const strategy = new ApiKeyStrategy({ keys: new Set(['secret-123']) });
    const result = await strategy.authenticate({
      headers: { 'x-api-key': ['secret-123', 'other'] },
    });
    expect(result.authenticated).toBe(true);
  });
});
