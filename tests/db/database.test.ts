import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/db/database.js';

describe('SCHEMA_SQL', () => {
  it('creates all expected tables', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);

    expect(names).toContain('schema_version');
    expect(names).toContain('sessions');
    expect(names).toContain('observations');
    expect(names).toContain('summaries');
    expect(names).toContain('pending_messages');
    db.close();
  });

  it('creates FTS5 virtual table for observations', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'observations_fts'"
    ).all();
    expect(tables.length).toBe(1);
    db.close();
  });

  it('creates FTS triggers', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);

    const triggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
    ).all() as { name: string }[];
    const names = triggers.map(t => t.name);

    expect(names).toContain('observations_ai');
    expect(names).toContain('observations_ad');
    expect(names).toContain('observations_au');
    db.close();
  });

  it('creates required indexes', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    ).all() as { name: string }[];
    const names = indexes.map(i => i.name);

    expect(names).toContain('idx_sessions_project');
    expect(names).toContain('idx_sessions_created');
    expect(names).toContain('idx_obs_session');
    expect(names).toContain('idx_obs_project');
    expect(names).toContain('idx_obs_hash');
    expect(names).toContain('idx_sum_project');
    expect(names).toContain('idx_pm_session');
    db.close();
  });

  it('enforces foreign keys between observations and sessions', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);

    expect(() => {
      db.prepare(
        `INSERT INTO observations (session_id, project, type, title, created_at, created_at_epoch)
         VALUES (999, 'proj', 'feature', 'title', '2026-01-01', 1000)`
      ).run();
    }).toThrow();

    db.close();
  });
});
