import { describe, expect, it } from 'vitest';
import { extractScopes } from './utils.js';

describe('extractScopes', () => {
  it('splits string scope on spaces', () => {
    const result = extractScopes({ scope: 'read write admin' });
    expect(result).toEqual(['read', 'write', 'admin']);
  });

  it('returns array scope as-is after filtering non-strings', () => {
    const result = extractScopes({ scope: ['read', 'write'] });
    expect(result).toEqual(['read', 'write']);
  });

  it('returns undefined for number scope', () => {
    const result = extractScopes({ scope: 42 });
    expect(result).toBeUndefined();
  });

  it('returns undefined for missing scope', () => {
    const result = extractScopes({});
    expect(result).toBeUndefined();
  });

  it('returns empty array for empty string scope', () => {
    const result = extractScopes({ scope: '' });
    expect(result).toEqual([]);
  });

  it('filters out non-strings from mixed-type array', () => {
    const result = extractScopes({ scope: ['read', 42, 'write', true, {}] });
    expect(result).toEqual(['read', 'write']);
  });

  it('returns undefined for object scope', () => {
    const result = extractScopes({ scope: { read: true } });
    expect(result).toBeUndefined();
  });
});
