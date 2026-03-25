import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/db/database.js';

let testDb: Database.Database;

vi.mock('../../src/db/database.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return {
    ...orig,
    getDb: () => testDb,
  };
});

import {
  createSession, completeSession, getSessionByContentId,
  setMemorySessionId, getMemorySessionId,
  storeObservation, getRecentObservations, deleteObservation,
  getObservationsByIds, getTimelineAroundObservation,
  storeSummary, getRecentSummaries, deleteSummary,
  deleteSession,
  searchObservationsFts,
  searchObservationsIndex,
  type ObservationInput,
} from '../../src/db/queries.js';

function insertObsDirect(sessionId: number, project: string, title: string, epoch: number, narrative = 'n/a') {
  const iso = new Date(epoch).toISOString();
  const result = testDb.prepare(
    `INSERT INTO observations (session_id, project, type, title, facts, narrative, files_read, files_modified, content_hash, created_at, created_at_epoch)
     VALUES (?, ?, 'feature', ?, '[]', ?, '[]', '[]', ?, ?, ?)`
  ).run(sessionId, project, title, narrative, `hash-${epoch}-${title}`, iso, epoch);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA_SQL);
  testDb.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(3);
});

describe('sessions', () => {
  it('createSession inserts and returns a session', () => {
    const session = createSession('cs-1', 'my-project', 'fix the bug');
    expect(session.content_session_id).toBe('cs-1');
    expect(session.project).toBe('my-project');
    expect(session.user_prompt).toBe('fix the bug');
    expect(session.status).toBe('active');
  });

  it('createSession with duplicate contentSessionId does INSERT OR IGNORE', () => {
    createSession('cs-1', 'proj', 'first');
    const second = createSession('cs-1', 'proj', 'second');
    expect(second.user_prompt).toBe('first');
  });

  it('createSession updates prompt if previously null', () => {
    createSession('cs-1', 'proj');
    const updated = createSession('cs-1', 'proj', 'now with prompt');
    expect(updated.user_prompt).toBe('now with prompt');
  });

  it('getSessionByContentId returns session', () => {
    createSession('cs-1', 'proj');
    const session = getSessionByContentId('cs-1');
    expect(session).toBeDefined();
    expect(session!.content_session_id).toBe('cs-1');
  });

  it('getSessionByContentId returns undefined for non-existent', () => {
    expect(getSessionByContentId('no-such')).toBeUndefined();
  });

  it('completeSession updates status', () => {
    createSession('cs-1', 'proj');
    completeSession('cs-1');
    const session = getSessionByContentId('cs-1');
    expect(session!.status).toBe('completed');
  });

  it('setMemorySessionId and getMemorySessionId round-trip', () => {
    createSession('cs-1', 'proj');
    setMemorySessionId('cs-1', 'mem-123');
    expect(getMemorySessionId('cs-1')).toBe('mem-123');
  });

  it('getMemorySessionId returns null when not set', () => {
    createSession('cs-1', 'proj');
    expect(getMemorySessionId('cs-1')).toBeNull();
  });
});

const obsInput: ObservationInput = {
  type: 'feature',
  title: 'Added auth',
  subtitle: null,
  facts: ['Implemented login flow'],
  narrative: 'Full login flow added.',
  concepts: [],
  files_read: ['src/auth.ts'],
  files_modified: ['src/routes/login.ts'],
};

describe('observations', () => {
  it('storeObservation inserts and returns new ID', () => {
    const session = createSession('cs-1', 'proj');
    const result = storeObservation(session.id, 'proj', obsInput, 'cs-1');
    expect(result.id).toBeGreaterThan(0);
    expect(result.deduplicated).toBe(false);
  });

  it('storeObservation deduplicates within 30s window', () => {
    const session = createSession('cs-1', 'proj');
    const first = storeObservation(session.id, 'proj', obsInput, 'cs-1');
    const second = storeObservation(session.id, 'proj', obsInput, 'cs-1');
    expect(second.deduplicated).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('getRecentObservations returns observations ordered by recency', () => {
    const session = createSession('cs-1', 'proj');
    const baseEpoch = 1700000000000;
    insertObsDirect(session.id, 'proj', 'First', baseEpoch);
    insertObsDirect(session.id, 'proj', 'Second', baseEpoch + 1000);
    const recent = getRecentObservations('proj', 10);
    expect(recent.length).toBe(2);
    expect(recent[0].title).toBe('Second');
    expect(recent[1].title).toBe('First');
  });

  it('getRecentObservations respects limit', () => {
    const session = createSession('cs-1', 'proj');
    const baseEpoch = 1700000000000;
    insertObsDirect(session.id, 'proj', 'A', baseEpoch);
    insertObsDirect(session.id, 'proj', 'B', baseEpoch + 1000);
    insertObsDirect(session.id, 'proj', 'C', baseEpoch + 2000);
    const recent = getRecentObservations('proj', 2);
    expect(recent.length).toBe(2);
  });

  it('getRecentObservations filters by project', () => {
    const s1 = createSession('cs-1', 'proj-a');
    const s2 = createSession('cs-2', 'proj-b');
    insertObsDirect(s1.id, 'proj-a', 'In A', 1700000000000);
    insertObsDirect(s2.id, 'proj-b', 'In B', 1700000001000);
    const results = getRecentObservations('proj-a', 10);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('In A');
  });

  it('deleteObservation removes observation and returns true', () => {
    const session = createSession('cs-1', 'proj');
    const { id } = storeObservation(session.id, 'proj', obsInput, 'cs-1');
    expect(deleteObservation(id)).toBe(true);
    expect(getObservationsByIds([id])).toEqual([]);
  });

  it('deleteObservation returns false for non-existent', () => {
    expect(deleteObservation(99999)).toBe(false);
  });

  it('getObservationsByIds returns observations in chronological order', () => {
    const session = createSession('cs-1', 'proj');
    const baseEpoch = 1700000000000;
    const idA = insertObsDirect(session.id, 'proj', 'First', baseEpoch);
    const idB = insertObsDirect(session.id, 'proj', 'Second', baseEpoch + 1000);
    const results = getObservationsByIds([idB, idA]);
    expect(results[0].title).toBe('First');
    expect(results[1].title).toBe('Second');
  });

  it('getObservationsByIds returns empty array for empty input', () => {
    expect(getObservationsByIds([])).toEqual([]);
  });
});

describe('summaries', () => {
  it('storeSummary inserts and returns ID', () => {
    const session = createSession('cs-1', 'proj');
    const id = storeSummary(session.id, 'proj', {
      request: 'Fix auth', investigated: 'Checked tokens',
      learned: 'Tokens expire', completed: 'Fixed refresh', next_steps: 'Add tests',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('allows multiple summaries per session', () => {
    const session = createSession('cs-1', 'proj');
    const id1 = storeSummary(session.id, 'proj', { request: 'A', investigated: null, learned: null, completed: null, next_steps: null });
    const id2 = storeSummary(session.id, 'proj', { request: 'B', investigated: null, learned: null, completed: null, next_steps: null });
    expect(id2).toBeGreaterThan(id1);
    const summaries = getRecentSummaries('proj', 10);
    expect(summaries.length).toBe(2);
  });

  it('deleteSummary removes summary and returns true', () => {
    const session = createSession('cs-1', 'proj');
    const id = storeSummary(session.id, 'proj', { request: 'X', investigated: null, learned: null, completed: null, next_steps: null });
    expect(deleteSummary(id)).toBe(true);
  });

  it('deleteSummary returns false for non-existent', () => {
    expect(deleteSummary(99999)).toBe(false);
  });
});

describe('searchObservationsFts', () => {
  it('finds observations by text match on title', () => {
    const session = createSession('cs-1', 'proj');
    insertObsDirect(session.id, 'proj', 'Zeppelin airship design', 1700000000000, 'Unique narrative about zeppelins');
    insertObsDirect(session.id, 'proj', 'Database migration fix', 1700000001000, 'Fixed the migration script');
    const results = searchObservationsFts('Zeppelin', undefined, 10);
    expect(results.length).toBe(1);
    expect(results[0].title).toContain('Zeppelin');
  });

  it('filters by project when provided', () => {
    const s1 = createSession('cs-1', 'proj-a');
    const s2 = createSession('cs-2', 'proj-b');
    insertObsDirect(s1.id, 'proj-a', 'Quantum flux capacitor', 1700000000000);
    insertObsDirect(s2.id, 'proj-b', 'Quantum entanglement module', 1700000001000);
    const results = searchObservationsFts('Quantum', 'proj-a', 10);
    expect(results.length).toBe(1);
    expect(results[0].project).toBe('proj-a');
  });

  it('handles special characters in query safely', () => {
    const session = createSession('cs-1', 'proj');
    insertObsDirect(session.id, 'proj', 'Test feature', 1700000000000);
    expect(() => searchObservationsFts('test*AND-OR"special', undefined, 10)).not.toThrow();
  });

  it('returns empty for no matches', () => {
    const session = createSession('cs-1', 'proj');
    insertObsDirect(session.id, 'proj', 'Some title', 1700000000000);
    const results = searchObservationsFts('absolutelynonexistentterm', undefined, 10);
    expect(results.length).toBe(0);
  });
});

describe('searchObservationsIndex', () => {
  it('applies type filter', () => {
    const session = createSession('cs-1', 'proj');
    const baseEpoch = 1700000000000;
    testDb.prepare(
      `INSERT INTO observations (session_id, project, type, title, facts, narrative, files_read, files_modified, content_hash, created_at, created_at_epoch)
       VALUES (?, 'proj', 'feature', 'Searchable feature', '[]', 'n/a', '[]', '[]', 'h1', ?, ?)`
    ).run(session.id, new Date(baseEpoch).toISOString(), baseEpoch);
    testDb.prepare(
      `INSERT INTO observations (session_id, project, type, title, facts, narrative, files_read, files_modified, content_hash, created_at, created_at_epoch)
       VALUES (?, 'proj', 'bugfix', 'Searchable bugfix', '[]', 'n/a', '[]', '[]', 'h2', ?, ?)`
    ).run(session.id, new Date(baseEpoch + 1000).toISOString(), baseEpoch + 1000);
    const results = searchObservationsIndex({ query: 'Searchable', type: 'bugfix' });
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('bugfix');
  });

  it('respects limit', () => {
    const session = createSession('cs-1', 'proj');
    const baseEpoch = 1700000000000;
    for (let i = 0; i < 5; i++) {
      insertObsDirect(session.id, 'proj', `Findable item ${i}`, baseEpoch + i * 1000);
    }
    const results = searchObservationsIndex({ query: 'Findable', limit: 2, offset: 0 });
    expect(results.length).toBe(2);
  });
});

describe('getTimelineAroundObservation', () => {
  it('returns anchor with before/after context', () => {
    const session = createSession('cs-1', 'proj');
    const baseEpoch = 1700000000000;
    insertObsDirect(session.id, 'proj', 'Before', baseEpoch);
    const anchorId = insertObsDirect(session.id, 'proj', 'Anchor', baseEpoch + 1000);
    insertObsDirect(session.id, 'proj', 'After', baseEpoch + 2000);
    const timeline = getTimelineAroundObservation(anchorId, 5, 5);
    expect(timeline.anchor).toBeDefined();
    expect(timeline.anchor!.title).toBe('Anchor');
    expect(timeline.before.length).toBe(1);
    expect(timeline.after.length).toBe(1);
  });

  it('returns null anchor for non-existent ID', () => {
    const timeline = getTimelineAroundObservation(99999);
    expect(timeline.anchor).toBeNull();
    expect(timeline.before).toEqual([]);
    expect(timeline.after).toEqual([]);
  });
});

describe('deleteSession', () => {
  it('cascades to observations and summaries', () => {
    const session = createSession('cs-1', 'proj');
    storeObservation(session.id, 'proj', obsInput, 'cs-1');
    storeSummary(session.id, 'proj', { request: 'X', investigated: null, learned: null, completed: null, next_steps: null });
    expect(deleteSession(session.id)).toBe(true);
    expect(getRecentObservations('proj', 10)).toEqual([]);
    expect(getRecentSummaries('proj', 10)).toEqual([]);
    expect(getSessionByContentId('cs-1')).toBeUndefined();
  });

  it('returns false for non-existent session', () => {
    expect(deleteSession(99999)).toBe(false);
  });
});

describe('FTS triggers', () => {
  it('insert populates FTS index', () => {
    const session = createSession('cs-1', 'proj');
    insertObsDirect(session.id, 'proj', 'Xylophone recital performance', 1700000000000);
    const results = searchObservationsFts('Xylophone', undefined, 10);
    expect(results.length).toBe(1);
  });

  it('delete removes from FTS index', () => {
    const session = createSession('cs-1', 'proj');
    const id = insertObsDirect(session.id, 'proj', 'Ephemeral butterfly observation', 1700000000000);
    deleteObservation(id);
    const results = searchObservationsFts('Ephemeral', undefined, 10);
    expect(results.length).toBe(0);
  });
});
