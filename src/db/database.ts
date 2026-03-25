import Database from 'better-sqlite3';
import { renameSync } from 'fs';
import { getLoadablePath } from 'sqlite-vec';
import { getDbPath, getDataDir } from '../utils/paths.js';
import { logger } from '../utils/logger.js';

export type { Database };

let db: Database.Database | null = null;
let dbReady = false;

export function isDbReady(): boolean {
  return dbReady;
}

const SCHEMA_VERSION = 3;

export const SCHEMA_SQL = `
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
  subtitle TEXT,
  facts TEXT,
  narrative TEXT,
  concepts TEXT,
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
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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
  3: (db) => {
    // Drop UNIQUE constraint on summaries.session_id to allow multiple summaries per session.
    // SQLite doesn't support DROP CONSTRAINT, so we recreate the table.
    db.exec(`
      CREATE TABLE IF NOT EXISTS summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );
      INSERT INTO summaries_new SELECT * FROM summaries;
      DROP TABLE summaries;
      ALTER TABLE summaries_new RENAME TO summaries;
      CREATE INDEX IF NOT EXISTS idx_sum_project ON summaries(project, created_at_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_sum_session ON summaries(session_id);
    `);
  },
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
    // Fresh install: run full schema and record version
    database.exec(SCHEMA_SQL);
    database.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    currentVersion = SCHEMA_VERSION;
  }

  // Run incremental migrations inside a transaction so partial failures
  // don't bump schema_version and leave the DB in a corrupt state.
  if (currentVersion < SCHEMA_VERSION) {
    database.transaction(() => {
      for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
        const migrate = MIGRATIONS[v];
        if (migrate) {
          migrate(database);
        }
      }
      database.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    })();
  }
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
    logger.info('db', 'sqlite-vec loaded successfully');
  } catch (err) {
    logger.info('db', 'sqlite-vec not available — semantic search disabled, FTS5 still works');
  }
}

export function openDb(dbPath: string): Database.Database {
  const database = new Database(dbPath);
  initializeSchema(database);

  // Integrity check: if the DB is corrupt, bail out now so the caller can recover.
  const result = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  if (result?.integrity_check !== 'ok') {
    database.close();
    throw new Error(`SQLite integrity check failed: ${result?.integrity_check}`);
  }

  return database;
}

export function backupCorruptedDb(dbPath: string): void {
  const backupPath = `${dbPath}.corrupted-${Date.now()}`;
  try {
    renameSync(dbPath, backupPath);
    logger.warn('db', `Corrupted DB moved to ${backupPath}. Starting fresh.`);
  } catch (renameErr) {
    logger.error('db', 'Failed to rename corrupted DB', renameErr);
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  getDataDir(); // ensure dir exists
  const dbPath = getDbPath();

  try {
    db = openDb(dbPath);
  } catch (err) {
    logger.error('db', 'DB open/init failed — attempting recovery', err);
    try { new Database(dbPath).close(); } catch {} // close if partially open
    backupCorruptedDb(dbPath);
    // Fresh DB
    db = openDb(dbPath);
    logger.info('db', 'Fresh DB created after recovery');
  }

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
