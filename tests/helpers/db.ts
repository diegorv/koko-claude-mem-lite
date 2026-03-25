import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/db/database.js';

/**
 * Creates an in-memory SQLite database with the full application schema.
 * Use this in tests instead of the real getDb() singleton.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(3);
  return db;
}
