import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../../src/db/database.js';

let testDb: Database.Database;

vi.mock('../../../src/db/database.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return { ...orig, getDb: () => testDb };
});

vi.mock('../../../src/worker/summarizer.js', () => ({
  reviewForCleanup: vi.fn().mockResolvedValue([]),
}));

import { cleanupRoutes } from '../../../src/worker/routes/cleanup.js';
import { createSession, storeObservation, storeSummary, type ObservationInput } from '../../../src/db/queries.js';

const obsInput: ObservationInput = {
  type: 'feature', title: 'Test', facts: [], narrative: 'n',
  files_read: [], files_modified: [],
};

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA_SQL);
});

describe('POST /cleanup/apply', () => {
  it('deletes specified observations', async () => {
    const session = createSession('cs-1', 'proj');
    const { id } = storeObservation(session.id, 'proj', obsInput, 'cs-1');
    const res = await cleanupRoutes.request('/cleanup/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletions: [{ id, type: 'observation' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(1);
  });

  it('deletes specified summaries', async () => {
    const session = createSession('cs-1', 'proj');
    const id = storeSummary(session.id, 'proj', {
      request: 'X', investigated: null, learned: null, completed: null, next_steps: null,
    });
    const res = await cleanupRoutes.request('/cleanup/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletions: [{ id, type: 'summary' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(1);
  });

  it('returns 400 for missing deletions', async () => {
    const res = await cleanupRoutes.request('/cleanup/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('handles non-existent IDs gracefully', async () => {
    const res = await cleanupRoutes.request('/cleanup/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletions: [{ id: 99999, type: 'observation' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(0);
  });

  it('handles mixed observation and summary deletions', async () => {
    const session = createSession('cs-1', 'proj');
    const obs = storeObservation(session.id, 'proj', obsInput, 'cs-1');
    const sumId = storeSummary(session.id, 'proj', {
      request: 'X', investigated: null, learned: null, completed: null, next_steps: null,
    });
    const res = await cleanupRoutes.request('/cleanup/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deletions: [
          { id: obs.id, type: 'observation' },
          { id: sumId, type: 'summary' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(2);
  });
});
