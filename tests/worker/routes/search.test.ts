import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../../src/db/database.js';

let testDb: Database.Database;

vi.mock('../../../src/db/database.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return { ...orig, getDb: () => testDb };
});

vi.mock('../../../src/embeddings/embeddings.js', () => ({
  searchSemantic: vi.fn().mockResolvedValue([]),
}));

import { searchRoutes } from '../../../src/worker/routes/search.js';

function insertSession(contentSessionId: string, project: string) {
  const now = Date.now();
  testDb.prepare(
    'INSERT INTO sessions (content_session_id, project, created_at, created_at_epoch) VALUES (?, ?, ?, ?)'
  ).run(contentSessionId, project, new Date(now).toISOString(), now);
  return testDb.prepare('SELECT * FROM sessions WHERE content_session_id = ?').get(contentSessionId) as any;
}

function insertObs(sessionId: number, project: string, title: string, epoch: number, type = 'feature') {
  testDb.prepare(
    `INSERT INTO observations (session_id, project, type, title, facts, narrative, files_read, files_modified, content_hash, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, '[]', 'narrative', '[]', '[]', ?, ?, ?)`
  ).run(sessionId, project, type, title, `h-${epoch}`, new Date(epoch).toISOString(), epoch);
}

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA_SQL);
});

describe('GET /search/index', () => {
  it('returns 400 without q parameter', async () => {
    const res = await searchRoutes.request('/search/index');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('q parameter required');
  });

  it('returns formatted results for valid query', async () => {
    const session = insertSession('cs-1', 'proj');
    insertObs(session.id, 'proj', 'Searchable widget feature', 1700000000000);
    const res = await searchRoutes.request('/search/index?q=Searchable');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBeDefined();
    expect(body.content[0].text).toContain('Searchable');
  });

  it('returns no results message for unmatched query', async () => {
    const res = await searchRoutes.request('/search/index?q=nonexistent');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content[0].text).toContain('No results found');
  });
});

  it('filters by type', async () => {
    const session = insertSession('cs-1', 'proj');
    insertObs(session.id, 'proj', 'Feature thing', 1700000000000, 'feature');
    insertObs(session.id, 'proj', 'Bug fix thing', 1700000001000, 'bugfix');
    const res = await searchRoutes.request('/search/index?q=thing&type=bugfix');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content[0].text).toContain('Bug fix thing');
    expect(body.content[0].text).not.toContain('Feature thing');
  });

  it('filters by dateStart (excludes older observations)', async () => {
    const session = insertSession('cs-1', 'proj');
    const old = new Date('2024-01-01T10:00:00Z').getTime();
    const recent = new Date('2024-06-01T10:00:00Z').getTime();
    insertObs(session.id, 'proj', 'Old observation', old);
    insertObs(session.id, 'proj', 'Recent observation', recent);
    const res = await searchRoutes.request('/search/index?q=observation&dateStart=2024-03-01');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content[0].text).toContain('Recent observation');
    expect(body.content[0].text).not.toContain('Old observation');
  });

  it('filters by dateEnd (excludes newer observations)', async () => {
    const session = insertSession('cs-1', 'proj');
    const old = new Date('2024-01-01T10:00:00Z').getTime();
    const recent = new Date('2024-06-01T10:00:00Z').getTime();
    insertObs(session.id, 'proj', 'January observation', old);
    insertObs(session.id, 'proj', 'June observation', recent);
    const res = await searchRoutes.request('/search/index?q=observation&dateEnd=2024-03-01');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content[0].text).toContain('January observation');
    expect(body.content[0].text).not.toContain('June observation');
  });

  it('combines dateStart and dateEnd as a range', async () => {
    const session = insertSession('cs-1', 'proj');
    insertObs(session.id, 'proj', 'January entry', new Date('2024-01-15T00:00:00Z').getTime());
    insertObs(session.id, 'proj', 'March entry', new Date('2024-03-15T00:00:00Z').getTime());
    insertObs(session.id, 'proj', 'December entry', new Date('2024-12-15T00:00:00Z').getTime());
    const res = await searchRoutes.request('/search/index?q=entry&dateStart=2024-02-01&dateEnd=2024-06-01');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content[0].text).toContain('March entry');
    expect(body.content[0].text).not.toContain('January entry');
    expect(body.content[0].text).not.toContain('December entry');
  });

describe('GET /timeline', () => {
  it('returns 400 without anchor parameter', async () => {
    const res = await searchRoutes.request('/timeline');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('anchor parameter required');
  });

  it('returns 404 for non-existent anchor', async () => {
    const res = await searchRoutes.request('/timeline?anchor=99999');
    expect(res.status).toBe(404);
  });

  it('returns formatted timeline for valid anchor', async () => {
    const session = insertSession('cs-1', 'proj');
    insertObs(session.id, 'proj', 'Anchor obs', 1700000000000);
    const obs = testDb.prepare('SELECT id FROM observations LIMIT 1').get() as any;
    const res = await searchRoutes.request(`/timeline?anchor=${obs.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content[0].text).toContain('ANCHOR');
  });
});

describe('POST /observations/batch', () => {
  it('returns 400 for missing ids', async () => {
    const res = await searchRoutes.request('/observations/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty ids array', async () => {
    const res = await searchRoutes.request('/observations/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when ids exceed MAX_BATCH', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    const res = await searchRoutes.request('/observations/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Too many IDs');
  });

  it('returns 400 for non-numeric ids', async () => {
    const res = await searchRoutes.request('/observations/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1, 'abc', 3] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('valid integers');
  });

  it('returns formatted observations for valid ids', async () => {
    const session = insertSession('cs-1', 'proj');
    insertObs(session.id, 'proj', 'Batch test obs', 1700000000000);
    const obs = testDb.prepare('SELECT id FROM observations LIMIT 1').get() as any;
    const res = await searchRoutes.request('/observations/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [obs.id] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content[0].text).toContain('Batch test obs');
  });
});

describe('GET /search', () => {
  it('returns 400 without q parameter', async () => {
    const res = await searchRoutes.request('/search');
    expect(res.status).toBe(400);
  });

  it('returns FTS results by default', async () => {
    const session = insertSession('cs-1', 'proj');
    insertObs(session.id, 'proj', 'Findable observation', 1700000000000);
    const res = await searchRoutes.request('/search?q=Findable');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('fts');
    expect(body.results.length).toBe(1);
  });
});
