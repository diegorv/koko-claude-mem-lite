import Database from 'better-sqlite3';
import { getLoadablePath } from 'sqlite-vec';
import { getDbPath, getDataDir } from '../utils/paths.js';

export type { Database };

let db: Database.Database | null = null;
let dbReady = false;

export function isDbReady(): boolean {
  return dbReady;
}

const SCHEMA_VERSION = 2;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_session_id TEXT UNIQUE NOT NULL,
  project TEXT NOT NULL,
  user_prompt TEXT,
  memory_session_id TEXT,
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

CREATE TABLE IF NOT EXISTS pending_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('observation','summary')),
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing')),
  created_at_epoch INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pm_session ON pending_messages(content_session_id, status);

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

// Incremental migrations keyed by target version number.
// Each function runs when upgrading FROM (version - 1) TO that version.
const MIGRATIONS: Record<number, (db: Database.Database) => void> = {
  // Example for future use:
  // 3: (db) => { db.exec('ALTER TABLE observations ADD COLUMN embedding_model TEXT'); },
};

function initializeSchema(database: Database.Database): void {
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('cache_size = 10000');
  database.pragma('busy_timeout = 5000');
  database.pragma('mmap_size = 268435456'); // 256MB mmap for improved read performance

  let currentVersion = 0;
  try {
    const row = database.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
    currentVersion = row?.version || 0;
  } catch {
    // Table doesn't exist yet — fresh install
  }

  if (currentVersion < 1) {
    // Fresh install: run full schema
    database.exec(SCHEMA_SQL);
    currentVersion = SCHEMA_VERSION;
  }

  // Run incremental migrations
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (migrate) {
      migrate(database);
    }
  }

  database.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
}

function tryLoadSqliteVec(database: Database.Database): void {
  try {
    database.loadExtension(getLoadablePath());
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS observations_vec USING vec0(
        observation_id INTEGER PRIMARY KEY,
        embedding float[1024]
      )
    `);
    console.log('[db] sqlite-vec loaded successfully');
  } catch (err) {
    console.log('[db] sqlite-vec not available — semantic search disabled, FTS5 still works');
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  getDataDir(); // ensure dir exists
  db = new Database(getDbPath());
  initializeSchema(db);
  tryLoadSqliteVec(db);
  dbReady = true;
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    dbReady = false;
  }
}
