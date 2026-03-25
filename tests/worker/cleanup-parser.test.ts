import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { parseCleanupResults, type CleanupItem } from '../../src/worker/summarizer.js';

const items: CleanupItem[] = [
  { id: 1, type: 'observation', text: 'obs one' },
  { id: 2, type: 'summary', text: 'sum two' },
  { id: 3, type: 'observation', text: 'obs three' },
];

describe('parseCleanupResults', () => {
  it('parses results with type prefix', () => {
    const xml = `<decisions>
<item id="observation#1">DELETE: low signal</item>
<item id="summary#2">KEEP: valuable</item>
<item id="observation#3">DELETE: noise</item>
</decisions>`;
    const results = parseCleanupResults(xml, items);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ id: 1, type: 'observation', action: 'delete', reason: 'low signal' });
    expect(results[1]).toEqual({ id: 2, type: 'summary', action: 'keep', reason: 'valuable' });
    expect(results[2]).toEqual({ id: 3, type: 'observation', action: 'delete', reason: 'noise' });
  });

  it('parses results without type prefix (fallback to first match)', () => {
    const xml = `<decisions>
<item id="1">DELETE: low signal</item>
</decisions>`;
    const results = parseCleanupResults(xml, items);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 1, type: 'observation', action: 'delete', reason: 'low signal' });
  });

  it('handles overlapping numeric IDs with type prefix correctly', () => {
    const overlapping: CleanupItem[] = [
      { id: 5, type: 'summary', text: 'sum five' },
      { id: 5, type: 'observation', text: 'obs five' },
    ];
    const xml = `<decisions>
<item id="summary#5">KEEP: important summary</item>
<item id="observation#5">DELETE: noise</item>
</decisions>`;
    const results = parseCleanupResults(xml, overlapping);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: 5, type: 'summary', action: 'keep', reason: 'important summary' });
    expect(results[1]).toEqual({ id: 5, type: 'observation', action: 'delete', reason: 'noise' });
  });

  it('deduplicates results with same type+id', () => {
    const xml = `<decisions>
<item id="observation#1">DELETE: first reason</item>
<item id="observation#1">DELETE: duplicate</item>
</decisions>`;
    const results = parseCleanupResults(xml, items);
    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe('first reason');
  });

  it('skips unmatched IDs', () => {
    const xml = `<decisions>
<item id="observation#999">DELETE: nonexistent</item>
<item id="observation#1">KEEP: real</item>
</decisions>`;
    const results = parseCleanupResults(xml, items);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it('skips wrong type prefix for a given ID', () => {
    const xml = `<decisions>
<item id="summary#1">DELETE: wrong type</item>
</decisions>`;
    const results = parseCleanupResults(xml, items);
    expect(results).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(parseCleanupResults('', [])).toEqual([]);
    expect(parseCleanupResults('no xml here', items)).toEqual([]);
  });

  it('handles mixed prefixed and unprefixed IDs', () => {
    const xml = `<decisions>
<item id="observation#1">DELETE: typed</item>
<item id="2">KEEP: untyped</item>
</decisions>`;
    const results = parseCleanupResults(xml, items);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: 1, type: 'observation', action: 'delete', reason: 'typed' });
    expect(results[1]).toEqual({ id: 2, type: 'summary', action: 'keep', reason: 'untyped' });
  });
});
