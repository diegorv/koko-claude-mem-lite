import { describe, it, expect } from 'vitest';
import { formatSearchIndex, formatTimeline, formatObservationsFull, parseJsonArray } from '../../src/worker/formatter.js';
import type { Observation, SearchIndexResult } from '../../src/db/queries.js';

function makeSearchResult(overrides: Partial<SearchIndexResult> = {}): SearchIndexResult {
  return {
    id: 1,
    type: 'feature',
    title: 'Test observation',
    narrative: 'Some narrative text here',
    facts: '["fact1"]',
    created_at: '2026-01-15T10:30:00.000Z',
    rank: 0,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 1,
    session_id: 1,
    project: 'test-project',
    type: 'feature',
    title: 'Test observation',
    facts: '["fact1","fact2"]',
    narrative: 'Some narrative',
    files_read: '["src/a.ts"]',
    files_modified: '["src/b.ts"]',
    content_hash: 'abc123',
    created_at: '2026-01-15T10:30:00.000Z',
    created_at_epoch: 1736937000,
    ...overrides,
  };
}

describe('formatSearchIndex', () => {
  it('returns fallback message for empty array', () => {
    expect(formatSearchIndex([])).toBe('No results found.');
  });

  it('produces markdown table with correct columns', () => {
    const result = formatSearchIndex([makeSearchResult()]);
    expect(result).toContain('| ID | Time | T | Title | ~Tokens |');
    expect(result).toContain('Found 1 result(s)');
  });

  it('shows correct type icon for feature', () => {
    const result = formatSearchIndex([makeSearchResult({ type: 'feature' })]);
    expect(result).toContain('🟢');
  });

  it('shows correct type icon for bugfix', () => {
    const result = formatSearchIndex([makeSearchResult({ type: 'bugfix' })]);
    expect(result).toContain('🔴');
  });

  it('deduplicates repeated timestamps', () => {
    const results = [
      makeSearchResult({ id: 1 }),
      makeSearchResult({ id: 2 }),
    ];
    const output = formatSearchIndex(results);
    expect(output).toContain('″');
  });

  it('truncates long titles at 60 chars', () => {
    const longTitle = 'A'.repeat(100);
    const result = formatSearchIndex([makeSearchResult({ title: longTitle })]);
    expect(result).not.toContain('A'.repeat(100));
    expect(result).toContain('...');
  });

  it('shows untitled for null title', () => {
    const result = formatSearchIndex([makeSearchResult({ title: null })]);
    expect(result).toContain('Untitled');
  });

  it('includes footer instruction', () => {
    const result = formatSearchIndex([makeSearchResult()]);
    expect(result).toContain('memory_timeline');
    expect(result).toContain('memory_get');
  });
});

describe('formatTimeline', () => {
  it('shows anchor marker', () => {
    const anchor = makeObservation({ id: 5 });
    const result = formatTimeline([], anchor, []);
    expect(result).toContain('ANCHOR');
    expect(result).toContain('#5');
  });

  it('shows before/after counts', () => {
    const before = [makeObservation({ id: 1 }), makeObservation({ id: 2 })];
    const anchor = makeObservation({ id: 3 });
    const after = [makeObservation({ id: 4 })];
    const result = formatTimeline(before, anchor, after);
    expect(result).toContain('2 before');
    expect(result).toContain('1 after');
  });

  it('groups observations by day', () => {
    const anchor = makeObservation({ id: 1, created_at: '2026-01-15T10:00:00Z' });
    const after = [makeObservation({ id: 2, created_at: '2026-01-16T14:00:00Z' })];
    const result = formatTimeline([], anchor, after);
    expect(result).toContain('### ');
  });

  it('includes markdown table headers', () => {
    const result = formatTimeline([], makeObservation(), []);
    expect(result).toContain('| ID | Time | T | Title | ~Tokens |');
  });
});

describe('formatObservationsFull', () => {
  it('returns fallback message for empty array', () => {
    expect(formatObservationsFull([])).toBe('No observations found for the given IDs.');
  });

  it('includes title with ID', () => {
    const result = formatObservationsFull([makeObservation({ id: 42, title: 'My Title' })]);
    expect(result).toContain('## #42');
    expect(result).toContain('My Title');
  });

  it('formats facts from JSON array', () => {
    const result = formatObservationsFull([makeObservation({ facts: '["fact A","fact B"]' })]);
    expect(result).toContain('fact A; fact B');
  });

  it('handles null facts gracefully', () => {
    const result = formatObservationsFull([makeObservation({ facts: null })]);
    expect(result).not.toContain('Facts');
  });

  it('handles null narrative gracefully', () => {
    const result = formatObservationsFull([makeObservation({ narrative: null })]);
    expect(result).not.toContain('Narrative');
  });

  it('shows files_read and files_modified', () => {
    const obs = makeObservation({
      files_read: '["src/a.ts"]',
      files_modified: '["src/b.ts"]',
    });
    const result = formatObservationsFull([obs]);
    expect(result).toContain('read: src/a.ts');
    expect(result).toContain('modified: src/b.ts');
  });

  it('handles null files gracefully', () => {
    const obs = makeObservation({ files_read: null, files_modified: null });
    const result = formatObservationsFull([obs]);
    expect(result).not.toContain('Files');
  });

  it('shows Untitled for null title', () => {
    const result = formatObservationsFull([makeObservation({ title: null })]);
    expect(result).toContain('Untitled');
  });
});

describe('parseJsonArray', () => {
  it('returns empty array for null', () => {
    expect(parseJsonArray(null)).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseJsonArray('not json')).toEqual([]);
  });

  it('returns empty array for non-array JSON', () => {
    expect(parseJsonArray('{"key":"val"}')).toEqual([]);
  });

  it('parses valid JSON array', () => {
    expect(parseJsonArray('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for empty string', () => {
    expect(parseJsonArray('')).toEqual([]);
  });
});
