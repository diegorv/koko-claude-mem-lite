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
      OBSERVATION_COUNT: 50,
      FULL_OBSERVATION_COUNT: 5,
      SUMMARY_COUNT: 3,
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
    `INSERT INTO observations (session_id, project, type, title, facts, narrative, files_read, files_modified, content_hash, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId, project, opts.type || 'feature', title,
    opts.facts || '["fact one","fact two"]',
    opts.narrative || 'A narrative about the observation.',
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

  it('includes recent summaries section', () => {
    const session = insertSession('cs-1', 'proj');
    insertSummary(session.id, 'proj', 'Fix authentication', 1700000000000);
    const ctx = generateContext('proj');
    expect(ctx).toContain('## Recent Summaries');
    expect(ctx).toContain('Fix authentication');
    expect(ctx).toContain('**Completed:** Completed Z');
    expect(ctx).toContain('**Learned:** Learned Y');
    expect(ctx).toContain('**Next steps:** Next: do W');
  });

  it('includes recent activity table', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Added feature X', 1700000000000);
    const ctx = generateContext('proj');
    expect(ctx).toContain('## Recent Activity');
    expect(ctx).toContain('| Time | Type | Title | Files |');
    expect(ctx).toContain('Added feature X');
  });

  it('includes details section for top observations', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Detailed obs', 1700000000000);
    const ctx = generateContext('proj');
    expect(ctx).toContain('## Details');
    expect(ctx).toContain('Detailed obs');
    expect(ctx).toContain('**Facts:**');
    expect(ctx).toContain('**Narrative:**');
  });

  it('shows file basenames in activity table', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'File test', 1700000000000, {
      files_read: '["src/deep/path/file.ts"]',
      files_modified: '["lib/other.ts"]',
    });
    const ctx = generateContext('proj');
    expect(ctx).toContain('file.ts');
    expect(ctx).toContain('other.ts');
  });

  it('handles observations with null fields', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Minimal', 1700000000000, {
      facts: null, narrative: null, files_read: null, files_modified: null,
    });
    const ctx = generateContext('proj');
    expect(ctx).toContain('Minimal');
  });
});

describe('generateContextDetailed', () => {
  it('returns breakdown with token estimate', () => {
    const session = insertSession('cs-1', 'proj');
    insertObservation(session.id, 'proj', 'Test', 1700000000000);
    const breakdown = generateContextDetailed('proj');
    expect(breakdown.context).toContain('<memory-lite-context>');
    expect(breakdown.estimatedTokens).toBeGreaterThan(0);
    expect(breakdown.estimatedTokens).toBe(Math.ceil(breakdown.context.length / 4));
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
