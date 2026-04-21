import { describe, expect, it } from 'vitest';
import { NoneStrategy } from './none.js';

describe('NoneStrategy', () => {
  it('always authenticates', async () => {
    const strategy = new NoneStrategy();
    const result = await strategy.authenticate({ headers: {} });
    expect(result.authenticated).toBe(true);
    expect(result.principal).toBe('anonymous');
  });
});
