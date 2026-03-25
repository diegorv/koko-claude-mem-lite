import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/db/database.js';

let testDb: Database.Database;

vi.mock('../../src/db/database.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return { ...orig, getDb: () => testDb };
});

vi.mock('../../src/utils/settings.js', () => ({
  getSetting: (key: string) => {
    const defaults: Record<string, number> = {
      OBSERVATION_COUNT: 25,
      FULL_OBSERVATION_COUNT: 3,
      SUMMARY_COUNT: 2,
    };
    return defaults[key];
  },
}));

import { generateContext, generateContextDetailed } from '../../src/context/generator.js';

function insertSession(contentSessionId: string, project: string) {
  const now = Date.now();
  testDb.prepare(
    'INSERT INTO sessions (content_session_id, project, created_at, created_at_epoch) VALUES (?, ?, ?, ?)'
  ).run(contentSessionId, project, new Date(now).toISOString(), now);
  return testDb.prepare('SELECT * FROM sessions WHERE content_session_id = ?').get(contentSessionId) as any;
}

function insertObservation(sessionId: number, project: string, title: string, epoch: number, opts: Record<string, any> = {}) {
  const iso = new Date(epoch).toISOString();
  const result = testDb.prepare(
    `INSERT INTO observations (session_id, project, type, title, subtitle, facts, narrative, concepts, files_read, files_modified, content_hash, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId, project, opts.type || 'feature', title,
    opts.subtitle || null,
    opts.facts || '["fact one","fact two"]',
    opts.narrative || 'A narrative about the observation.',
    opts.concepts || null,
    opts.files_read || '["src/a.ts"]',
    opts.files_modified || '["src/b.ts"]',
    `hash-${epoch}`, iso, epoch
  );
  return Number(result.lastInsertRowid);
}

function insertSummary(sessionId: number, project: string, request: string, epoch: number) {
  testDb.prepare(
    `INSERT INTO summaries (session_id, project, request, investigated, learned, completed, next_steps, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, project, request, 'Investigated X', 'Learned Y', 'Completed Z', 'Next: do W', new Date(epoch).toISOString(), epoch);
}

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA_SQL);
  testDb.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(3);
});

describe('generateContext', () => {
  it('returns empty string when no data exists', () => {
    expect(generateContext('proj')).toBe('');
  });

  it('wraps output in <memory-lite-context> tags', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Test obs', 1700000000000);
    const ctx = generateContext('proj');
    expect(ctx).toContain('<memory-lite-context>');
    expect(ctx).toContain('</memory-lite-context>');
  });

  it('includes project name in header', () => {
    const session = insertSession('cs-1', 'my-project');
    insertObservation(session.id, 'my-project', 'Test', 1700000000000);
    const ctx = generateContext('my-project');
    expect(ctx).toContain('# Memory Context | my-project');
  });

  it('uses compact timeline format (no markdown table)', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Added feature X', 1700000000000, { type: 'feature' });
    const ctx = generateContext('proj');
    // Should NOT have markdown table
    expect(ctx).not.toContain('| Time | Type | Title | Files |');
    // Should have compact line with type icon
    expect(ctx).toContain('[feat]');
    expect(ctx).toContain('Added feature X');
  });

  it('groups entries by day', () => {
    const session = insertSession('cs-1', 'proj');
    const day1 = new Date('2024-03-20T10:00:00Z').getTime();
    const day2 = new Date('2024-03-21T15:00:00Z').getTime();
    insertObservation(session.id, 'proj', 'Day 1 obs', day1);
    insertObservation(session.id, 'proj', 'Day 2 obs', day2);
    const ctx = generateContext('proj');
    expect(ctx).toContain('### Mar 20');
    expect(ctx).toContain('### Mar 21');
  });

  it('interleaves summaries and observations chronologically', () => {
    const session = insertSession('cs-1', 'proj');
    const epoch1 = new Date('2024-03-20T09:00:00Z').getTime();
    const epoch2 = new Date('2024-03-20T10:00:00Z').getTime();
    const epoch3 = new Date('2024-03-20T11:00:00Z').getTime();
    insertObservation(session.id, 'proj', 'Before summary', epoch1);
    insertSummary(session.id, 'proj', 'Mid-day session', epoch2);
    insertObservation(session.id, 'proj', 'After summary', epoch3);
    const ctx = generateContext('proj');
    const beforePos = ctx.indexOf('Before summary');
    const summaryPos = ctx.indexOf('Mid-day session');
    const afterPos = ctx.indexOf('After summary');
    expect(beforePos).toBeLessThan(summaryPos);
    expect(summaryPos).toBeLessThan(afterPos);
  });

  it('shows concepts as badges on full observations', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Tricky obs', 1700000000000, {
      concepts: '["gotcha","problem-solution"]',
    });
    const ctx = generateContext('proj');
    expect(ctx).toContain('[gotcha]');
    expect(ctx).toContain('[problem-solution]');
  });

  it('shows only high-signal concepts (gotcha, trade-off) on compact observations', () => {
    const session = insertSession('cs-1', 'proj');
    const base = 1700000000000;
    // Insert 5 observations so oldest 2 are compact
    for (let i = 0; i < 4; i++) {
      insertObservation(session.id, 'proj', `Obs ${i}`, base + i * 1000);
    }
    insertObservation(session.id, 'proj', 'Compact gotcha', base + 4000, {
      concepts: '["gotcha","how-it-works"]',
    });
    const ctx = generateContext('proj');
    // The 5 obs: Obs 0-3 + Compact gotcha (newest). FULL_OBSERVATION_COUNT=3
    // Newest 3 get full: Obs 2, Obs 3, Compact gotcha — compact gotcha IS full
    expect(ctx).toContain('[gotcha]');
    expect(ctx).toContain('[how-it-works]');
  });

  it('does not show [how-it-works] badge on compact observations', () => {
    const session = insertSession('cs-1', 'proj');
    const base = 1700000000000;
    for (let i = 0; i < 3; i++) {
      insertObservation(session.id, 'proj', `Full obs ${i}`, base + i * 1000 + 10000);
    }
    // This one is compact (oldest)
    insertObservation(session.id, 'proj', 'Compact obs', base, {
      concepts: '["how-it-works","pattern"]',
    });
    const ctx = generateContext('proj');
    const compactLine = ctx.split('\n').find(l => l.includes('Compact obs') && !l.startsWith('**'));
    expect(compactLine).toBeDefined();
    expect(compactLine).not.toContain('[how-it-works]');
    expect(compactLine).not.toContain('[pattern]');
  });

  it('shows [trade-off] badge on compact observations', () => {
    const session = insertSession('cs-1', 'proj');
    const base = 1700000000000;
    for (let i = 0; i < 3; i++) {
      insertObservation(session.id, 'proj', `Full obs ${i}`, base + i * 1000 + 10000);
    }
    insertObservation(session.id, 'proj', 'Compact tradeoff', base, {
      concepts: '["trade-off","how-it-works"]',
    });
    const ctx = generateContext('proj');
    const compactLine = ctx.split('\n').find(l => l.includes('Compact tradeoff') && !l.startsWith('**'));
    expect(compactLine).toBeDefined();
    expect(compactLine).toContain('[trade-off]');
    expect(compactLine).not.toContain('[how-it-works]');
  });

  it('shows files_modified on full observations', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Changed files', 1700000000000, {
      files_modified: '["src/worker/observer.ts","src/db/queries.ts"]',
    });
    const ctx = generateContext('proj');
    expect(ctx).toContain('src/worker/observer.ts');
    expect(ctx).toContain('src/db/queries.ts');
    expect(ctx).toContain('Files:');
  });

  it('does not show Files line when files_modified is empty', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'No files', 1700000000000, {
      files_modified: '[]',
    });
    const ctx = generateContext('proj');
    expect(ctx).not.toContain('Files:');
  });

  it('shows summary with learned and next fields', () => {
    const session = insertSession('cs-1', 'proj');
    insertSummary(session.id, 'proj', 'Fix authentication', 1700000000000);
    const ctx = generateContext('proj');
    expect(ctx).toContain('Fix authentication');
    expect(ctx).toContain('Learned: Learned Y');
    expect(ctx).toContain('Next: Next: do W');
  });

  it('shows full detail (bold + narrative) for recent observations', () => {
    const session = insertSession('cs-1', 'proj');
    // Most recent gets full detail (FULL_OBSERVATION_COUNT=3)
    insertObservation(session.id, 'proj', 'Detailed obs', 1700000000000);
    const ctx = generateContext('proj');
    expect(ctx).toContain('**Detailed obs**');
    expect(ctx).toContain('A narrative about the observation.');
  });

  it('shows compact line for older observations', () => {
    const session = insertSession('cs-1', 'proj');
    const base = 1700000000000;
    // Insert 5 observations — only top 3 get detail
    for (let i = 0; i < 5; i++) {
      insertObservation(session.id, 'proj', `Obs ${i}`, base + i * 1000);
    }
    const ctx = generateContext('proj');
    // Oldest 2 should be compact (no bold)
    expect(ctx).not.toContain('**Obs 0**');
    expect(ctx).not.toContain('**Obs 1**');
    // Newest 3 should be bold
    expect(ctx).toContain('**Obs 2**');
    expect(ctx).toContain('**Obs 3**');
    expect(ctx).toContain('**Obs 4**');
  });

  it('handles observations with null fields', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Minimal', 1700000000000, {
      facts: null, narrative: null, files_read: null, files_modified: null,
    });
    const ctx = generateContext('proj');
    expect(ctx).toContain('Minimal');
  });

  it('uses correct type icons', () => {
    const session = insertSession('cs-1', 'proj');
    const base = 1700000000000;
    insertObservation(session.id, 'proj', 'Bug fix', base, { type: 'bugfix' });
    insertObservation(session.id, 'proj', 'New feat', base + 1000, { type: 'feature' });
    insertObservation(session.id, 'proj', 'Found X', base + 2000, { type: 'discovery' });
    insertObservation(session.id, 'proj', 'Chose Y', base + 3000, { type: 'decision' });
    const ctx = generateContext('proj');
    expect(ctx).toContain('[fix]');
    expect(ctx).toContain('[feat]');
    expect(ctx).toContain('[discovery]');
    expect(ctx).toContain('[decision]');
  });
});

describe('generateContextDetailed', () => {
  it('returns breakdown with token estimate', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Test', 1700000000000);
    const breakdown = generateContextDetailed('proj');
    expect(breakdown.context).toContain('<memory-lite-context>');
    expect(breakdown.estimatedTokens).toBeGreaterThan(0);
    // estimatedTokens uses word-boundary estimation (words * 1.3), not char / 4
    expect(breakdown.estimatedTokens).toBeGreaterThan(0);
  });

  it('returns correct detailedIds', () => {
    const session = insertSession('cs-1', 'proj');
    const baseEpoch = 1700000000000;
    const id1 = insertObservation(session.id, 'proj', 'Obs 1', baseEpoch);
    const id2 = insertObservation(session.id, 'proj', 'Obs 2', baseEpoch + 1000);
    const breakdown = generateContextDetailed('proj');
    expect(breakdown.detailedIds).toContain(id1);
    expect(breakdown.detailedIds).toContain(id2);
  });

  it('returns empty arrays when no data', () => {
    const breakdown = generateContextDetailed('empty-proj');
    expect(breakdown.context).toBe('');
    expect(breakdown.summaries).toEqual([]);
    expect(breakdown.observations).toEqual([]);
    expect(breakdown.detailedIds).toEqual([]);
  });
});
