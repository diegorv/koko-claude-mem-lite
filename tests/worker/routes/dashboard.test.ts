import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../../src/db/database.js';

let testDb: Database.Database;

vi.mock('../../../src/db/database.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return { ...orig, getDb: () => testDb };
});

vi.mock('../../../src/worker/observer.js', () => ({
  getActiveSessionIds: () => ['active-1'],
}));

vi.mock('../../../src/utils/settings.js', () => ({
  getSetting: (key: string) => {
    const defaults: Record<string, number> = {
      OBSERVATION_COUNT: 50, FULL_OBSERVATION_COUNT: 5, SUMMARY_COUNT: 3,
    };
    return defaults[key];
  },
}));

import { dashboardRoutes } from '../../../src/worker/routes/dashboard.js';

function seedData() {
  const now = Date.now();
  testDb.prepare(
    'INSERT INTO sessions (content_session_id, project, created_at, created_at_epoch) VALUES (?, ?, ?, ?)'
  ).run('cs-1', 'proj-a', new Date(now).toISOString(), now);
  const session = testDb.prepare("SELECT id FROM sessions WHERE content_session_id = 'cs-1'").get() as any;

  testDb.prepare(
    `INSERT INTO observations (session_id, project, type, title, facts, narrative, files_read, files_modified, content_hash, created_at, created_at_epoch)
     VALUES (?, 'proj-a', 'feature', 'Obs 1', '[]', 'n', '[]', '[]', 'h1', ?, ?)`
  ).run(session.id, new Date(now).toISOString(), now);

  testDb.prepare(
    `INSERT INTO summaries (session_id, project, request, created_at, created_at_epoch)
     VALUES (?, 'proj-a', 'Fix bug', ?, ?)`
  ).run(session.id, new Date(now).toISOString(), now);

  return session;
}

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA_SQL);
});

describe('GET /dashboard/sessions', () => {
  it('returns paginated sessions', async () => {
    seedData();
    const res = await dashboardRoutes.request('/dashboard/sessions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.length).toBe(1);
    expect(body.total).toBe(1);
  });

  it('filters by project', async () => {
    seedData();
    const res = await dashboardRoutes.request('/dashboard/sessions?project=proj-b');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.length).toBe(0);
    expect(body.total).toBe(0);
  });

  it('returns empty when no sessions', async () => {
    const res = await dashboardRoutes.request('/dashboard/sessions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });
});

describe('GET /dashboard/sessions/:sessionId/observations', () => {
  it('returns observations for session', async () => {
    const session = seedData();
    const res = await dashboardRoutes.request(`/dashboard/sessions/${session.id}/observations`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.observations.length).toBe(1);
  });

  it('returns empty for non-existent session', async () => {
    const res = await dashboardRoutes.request('/dashboard/sessions/99999/observations');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.observations).toEqual([]);
  });
});

describe('GET /dashboard/projects', () => {
  it('returns project list with stats', async () => {
    seedData();
    const res = await dashboardRoutes.request('/dashboard/projects');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects.length).toBe(1);
    expect(body.projects[0].project).toBe('proj-a');
    expect(body.projects[0].session_count).toBe(1);
  });
});

describe('GET /dashboard/stats', () => {
  it('returns counts for all entity types', async () => {
    seedData();
    const res = await dashboardRoutes.request('/dashboard/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBe(1);
    expect(body.observations).toBe(1);
    expect(body.summaries).toBe(1);
    expect(body.projects).toBe(1);
    expect(body.activeObservers).toBe(1);
    expect(typeof body.uptime).toBe('number');
  });

  it('returns zero counts when empty', async () => {
    const res = await dashboardRoutes.request('/dashboard/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBe(0);
    expect(body.observations).toBe(0);
  });
});

describe('GET /dashboard/feed', () => {
  it('returns merged observations and summaries', async () => {
    seedData();
    const res = await dashboardRoutes.request('/dashboard/feed');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feed.length).toBe(2);
  });

  it('filters by project', async () => {
    seedData();
    const res = await dashboardRoutes.request('/dashboard/feed?project=proj-b');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feed.length).toBe(0);
  });

  it('returns empty feed when no data', async () => {
    const res = await dashboardRoutes.request('/dashboard/feed');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feed).toEqual([]);
  });
});

describe('GET /dashboard/context-preview', () => {
  it('returns context breakdown', async () => {
    seedData();
    const res = await dashboardRoutes.request('/dashboard/context-preview?project=proj-a');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.context).toBeDefined();
    expect(typeof body.estimatedTokens).toBe('number');
  });
});
