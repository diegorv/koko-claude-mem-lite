import { describe, it, expect } from 'vitest';
import { computeContentHash } from '../../src/utils/hash.js';

describe('computeContentHash', () => {
  it('returns a 16-char hex string', () => {
    const hash = computeContentHash('session-1', 'title', 'narrative');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic (same input → same output)', () => {
    const a = computeContentHash('s1', 'title', 'narrative');
    const b = computeContentHash('s1', 'title', 'narrative');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = computeContentHash('s1', 'title-a', 'narrative');
    const b = computeContentHash('s1', 'title-b', 'narrative');
    expect(a).not.toBe(b);
  });

  it('sessionId contributes to uniqueness', () => {
    const a = computeContentHash('s1', 'same', 'same');
    const b = computeContentHash('s2', 'same', 'same');
    expect(a).not.toBe(b);
  });

  it('handles null title and narrative', () => {
    const hash = computeContentHash('s1', null, null);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles empty strings', () => {
    const hash = computeContentHash('', '', '');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
