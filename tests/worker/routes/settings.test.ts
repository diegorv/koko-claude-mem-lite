import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../../src/db/database.js';

let testDb: Database.Database;
let mockDbReady = true;

vi.mock('../../../src/db/database.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return {
    ...orig,
    getDb: () => testDb,
    isDbReady: () => mockDbReady,
  };
});

vi.mock('../../../src/utils/settings.js', () => ({
  getAllSettings: () => ({
    WORKER_PORT: 37888, OBSERVATION_COUNT: 50,
    FULL_OBSERVATION_COUNT: 5, SUMMARY_COUNT: 3,
  }),
  updateSettings: vi.fn((partial: any) => ({
    WORKER_PORT: 37888, OBSERVATION_COUNT: 50,
    FULL_OBSERVATION_COUNT: 5, SUMMARY_COUNT: 3, ...partial,
  })),
}));

vi.mock('../../../src/context/generator.js', () => ({
  generateContext: (project: string) => `<memory-lite-context>ctx for ${project}</memory-lite-context>`,
}));

vi.mock('../../../src/worker/observer.js', () => ({
  getActiveSessionIds: () => ['s1', 's2'],
  getSessionAge: () => 5000,
}));

import { settingsRoutes } from '../../../src/worker/routes/settings.js';
import { createSession, storeObservation, storeSummary, type ObservationInput } from '../../../src/db/queries.js';

const obsInput: ObservationInput = {
  type: 'feature', title: 'Test', facts: [], narrative: 'n',
  files_read: [], files_modified: [],
};

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA_SQL);
  mockDbReady = true;
});

describe('GET /health', () => {
  it('returns { ok: true }', async () => {
    const res = await settingsRoutes.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('GET /readiness', () => {
  it('returns 200 when DB is ready', async () => {
    mockDbReady = true;
    const res = await settingsRoutes.request('/readiness');
    expect(res.status).toBe(200);
  });

  it('returns 503 when DB is not ready', async () => {
    mockDbReady = false;
    const res = await settingsRoutes.request('/readiness');
    expect(res.status).toBe(503);
  });
});

describe('GET /context', () => {
  it('returns context for project', async () => {
    const res = await settingsRoutes.request('/context?project=my-proj');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.context).toContain('my-proj');
  });

  it('defaults project to unknown', async () => {
    const res = await settingsRoutes.request('/context');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.context).toContain('unknown');
  });
});

describe('GET /settings', () => {
  it('returns current settings', async () => {
    const res = await settingsRoutes.request('/settings');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.WORKER_PORT).toBe(37888);
  });
});

describe('DELETE /observations/:id', () => {
  it('returns 400 for invalid ID', async () => {
    const res = await settingsRoutes.request('/observations/abc', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent observation', async () => {
    const res = await settingsRoutes.request('/observations/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('deletes and returns ok', async () => {
    const session = createSession('cs-1', 'proj');
    const { id } = storeObservation(session.id, 'proj', obsInput, 'cs-1');
    const res = await settingsRoutes.request(`/observations/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('DELETE /summaries/:id', () => {
  it('returns 404 for non-existent summary', async () => {
    const res = await settingsRoutes.request('/summaries/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('deletes and returns ok', async () => {
    const session = createSession('cs-1', 'proj');
    const id = storeSummary(session.id, 'proj', {
      request: 'X', investigated: null, learned: null, completed: null, next_steps: null,
    });
    const res = await settingsRoutes.request(`/summaries/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('DELETE /sessions/:id', () => {
  it('returns 404 for non-existent session', async () => {
    const res = await settingsRoutes.request('/sessions/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('cascades delete and returns ok', async () => {
    const session = createSession('cs-1', 'proj');
    storeObservation(session.id, 'proj', obsInput, 'cs-1');
    const res = await settingsRoutes.request(`/sessions/${session.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
