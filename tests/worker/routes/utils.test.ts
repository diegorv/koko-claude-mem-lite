import { describe, it, expect } from 'vitest';
import { clamp, safeParseInt, MAX_LIMIT, MAX_DEPTH, MAX_BATCH } from '../../../src/worker/routes/utils.js';

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 1, 10)).toBe(5);
  });

  it('returns min when value is below', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('returns max when value is above', () => {
    expect(clamp(100, 0, 10)).toBe(10);
  });

  it('handles equal min and max', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it('handles value equal to min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('handles value equal to max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('safeParseInt', () => {
  it('parses valid integer string', () => {
    expect(safeParseInt('42', 0)).toBe(42);
  });

  it('returns fallback for undefined', () => {
    expect(safeParseInt(undefined, 10)).toBe(10);
  });

  it('returns fallback for non-numeric string', () => {
    expect(safeParseInt('abc', 5)).toBe(5);
  });

  it('returns fallback for empty string', () => {
    expect(safeParseInt('', 7)).toBe(7);
  });

  it('parses negative integers', () => {
    expect(safeParseInt('-3', 0)).toBe(-3);
  });

  it('parses string with trailing non-numeric chars', () => {
    expect(safeParseInt('42abc', 0)).toBe(42);
  });
});

describe('constants', () => {
  it('MAX_LIMIT is 500', () => {
    expect(MAX_LIMIT).toBe(500);
  });

  it('MAX_DEPTH is 50', () => {
    expect(MAX_DEPTH).toBe(50);
  });

  it('MAX_BATCH is 100', () => {
    expect(MAX_BATCH).toBe(100);
  });
});
