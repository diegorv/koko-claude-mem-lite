import { describe, it, expect } from 'vitest';
import { stripPrivateTags, isEntirelyPrivate } from '../../src/utils/privacy.js';

describe('stripPrivateTags', () => {
  it('removes <private> tags', () => {
    expect(stripPrivateTags('before <private>secret</private> after')).toBe('before  after');
  });

  it('removes <memory-lite-context> tags', () => {
    expect(stripPrivateTags('before <memory-lite-context>ctx</memory-lite-context> after')).toBe('before  after');
  });

  it('preserves content outside tags', () => {
    expect(stripPrivateTags('hello world')).toBe('hello world');
  });

  it('handles multiple private tags', () => {
    const input = '<private>a</private> middle <private>b</private>';
    expect(stripPrivateTags(input)).toBe('middle');
  });

  it('handles multiline content within tags', () => {
    const input = '<private>\nline1\nline2\n</private>';
    expect(stripPrivateTags(input)).toBe('');
  });

  it('handles mixed tag types', () => {
    const input = '<private>a</private> text <memory-lite-context>b</memory-lite-context>';
    expect(stripPrivateTags(input)).toBe('text');
  });

  it('returns empty string for all-private content', () => {
    expect(stripPrivateTags('<private>all secret</private>')).toBe('');
  });

  it('trims result', () => {
    expect(stripPrivateTags('  <private>x</private>  ')).toBe('');
  });
});

describe('isEntirelyPrivate', () => {
  it('returns true when all content is private-tagged', () => {
    expect(isEntirelyPrivate('<private>secret</private>')).toBe(true);
  });

  it('returns false when public content exists', () => {
    expect(isEntirelyPrivate('<private>secret</private> public')).toBe(false);
  });

  it('returns true for empty string', () => {
    expect(isEntirelyPrivate('')).toBe(true);
  });

  it('returns true when both tag types wrap all content', () => {
    expect(isEntirelyPrivate('<private>a</private><memory-lite-context>b</memory-lite-context>')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isEntirelyPrivate('hello')).toBe(false);
  });
});
