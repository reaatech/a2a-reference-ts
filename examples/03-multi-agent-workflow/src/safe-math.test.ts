import { describe, expect, it } from 'vitest';
import { safeEval } from './safe-math.js';

describe('safeEval', () => {
  it('evaluates basic arithmetic', () => {
    expect(safeEval('2 + 3')).toBe(5);
    expect(safeEval('10 - 4')).toBe(6);
    expect(safeEval('3 * 4')).toBe(12);
    expect(safeEval('8 / 2')).toBe(4);
  });

  it('evaluates expressions with parentheses', () => {
    expect(safeEval('2 + 3 * 4')).toBe(14);
    expect(safeEval('(2 + 3) * 4')).toBe(20);
  });

  it('evaluates decimal numbers', () => {
    expect(safeEval('3.5 + 2.5')).toBe(6);
  });

  it('evaluates negative numbers', () => {
    expect(safeEval('-5 + 3')).toBe(-2);
  });

  it('throws on invalid characters', () => {
    expect(() => safeEval('2 + abc')).toThrow();
  });

  it('throws on division by zero', () => {
    expect(() => safeEval('1 / 0')).toThrow('Division by zero');
  });
});
