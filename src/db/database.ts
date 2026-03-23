import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';
import { getDbPath, getDataDir } from '../utils/paths.js';

let db: Database | null = null;

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_session_id TEXT UNIQUE NOT NULL,
  project TEXT NOT NULL,
  user_prompt TEXT,
  status TEXT CHECK(status IN ('active','completed')) NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at_epoch DESC);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  facts TEXT,
  narrative TEXT,
  files_read TEXT,
  files_modified TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_obs_project ON observations(project, created_at_epoch DESC);
CREATE INDEX IF NOT EXISTS idx_obs_hash ON observations(content_hash, created_at_epoch);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER UNIQUE NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  request TEXT,
  investigated TEXT,
  learned TEXT,
  completed TEXT,
  next_steps TEXT,
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sum_project ON summaries(project, created_at_epoch DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  title, narrative, facts,
  content='observations', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, title, narrative, facts)
  VALUES (new.id, new.title, new.narrative, new.facts);
END;

CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, narrative, facts)
  VALUES ('delete', old.id, old.title, old.narrative, old.facts);
END;

CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, narrative, facts)
  VALUES ('delete', old.id, old.title, old.narrative, old.facts);
  INSERT INTO observations_fts(rowid, title, narrative, facts)
  VALUES (new.id, new.title, new.narrative, new.facts);
END;
`;

function initializeSchema(database: Database): void {
  database.run('PRAGMA journal_mode = WAL');
  database.run('PRAGMA foreign_keys = ON');
  database.run('PRAGMA cache_size = 10000');

  const versionRow = (() => {
    try {
      return database.query('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | null;
    } catch {
      return null;
    }
  })();

  if (!versionRow || versionRow.version < SCHEMA_VERSION) {
    database.exec(SCHEMA_SQL);
    database.run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
  }
}

function tryLoadSqliteVec(database: Database): void {
  try {
    // sqlite-vec is a loadable extension — try common paths
    const paths = [
      'vec0', // if installed globally or in LD_LIBRARY_PATH
      '/opt/homebrew/lib/vec0',
      '/usr/local/lib/vec0',
    ];
    for (const p of paths) {
      try {
        database.loadExtension(p);
        database.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS observations_vec USING vec0(
            observation_id INTEGER PRIMARY KEY,
            embedding float[1024]
          )
        `);
        console.log('[db] sqlite-vec loaded successfully');
        return;
      } catch { /* try next path */ }
    }
    console.log('[db] sqlite-vec not available — semantic search disabled, FTS5 still works');
  } catch {
    console.log('[db] sqlite-vec not available — semantic search disabled, FTS5 still works');
  }
}

export function getDb(): Database {
  if (db) return db;

  getDataDir(); // ensure dir exists
  db = new Database(getDbPath());
  initializeSchema(db);
  tryLoadSqliteVec(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
