import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../../src/utils/tokens.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(estimateTokens('   ')).toBe(0);
  });

  it('estimates a single word as 2 tokens (ceil(1 * 1.3))', () => {
    expect(estimateTokens('hello')).toBe(2);
  });

  it('estimates a short sentence', () => {
    // "The quick brown fox" = 4 words → ceil(4 * 1.3) = ceil(5.2) = 6
    expect(estimateTokens('The quick brown fox')).toBe(6);
  });

  it('handles multiple whitespace between words', () => {
    // Same as single-spaced
    expect(estimateTokens('foo   bar   baz')).toBe(estimateTokens('foo bar baz'));
  });

  it('handles newlines as whitespace separators', () => {
    expect(estimateTokens('line one\nline two\nline three')).toBe(
      estimateTokens('line one line two line three')
    );
  });

  it('produces higher estimate than naive length/4 for typical code', () => {
    // Code tends to have short tokens; word-based should be >= char/4
    const code = 'const x = foo.bar() + baz(1, 2);';
    const wordBased = estimateTokens(code);
    const charBased = Math.ceil(code.length / 4);
    // Both are rough estimates; just assert wordBased is in a sane range
    expect(wordBased).toBeGreaterThan(0);
    expect(wordBased).toBeGreaterThanOrEqual(charBased);
  });

  it('scales linearly with repetition', () => {
    const single = estimateTokens('hello world');
    const doubled = estimateTokens('hello world hello world');
    expect(doubled).toBe(single * 2);
  });
});
