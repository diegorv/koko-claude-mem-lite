import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDb, backupCorruptedDb } from '../../src/db/database.js';

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'memory-lite-repair-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tempDirs = [];
});

describe('openDb', () => {
  it('opens a fresh DB path and returns a working database', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'test.db');
    const db = openDb(dbPath);
    expect(db).toBeDefined();
    // Verify schema was created
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('sessions');
    expect(names).toContain('observations');
    db.close();
  });

  it('throws when the DB file is corrupt (garbage content)', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'corrupt.db');
    writeFileSync(dbPath, 'this is not a sqlite database\x00garbage\xff');
    expect(() => openDb(dbPath)).toThrow();
  });

  it('passes integrity check on a valid DB', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'valid.db');
    const db = openDb(dbPath);
    // Should not throw — if we got here, integrity check passed
    expect(db).toBeDefined();
    db.close();
  });
});

describe('backupCorruptedDb', () => {
  it('renames the DB file to a .corrupted-{timestamp} backup', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'data.db');
    writeFileSync(dbPath, 'garbage content');

    backupCorruptedDb(dbPath);

    expect(existsSync(dbPath)).toBe(false);
    const files = readdirSync(dir);
    const backups = files.filter(f => f.startsWith('data.db.corrupted-'));
    expect(backups.length).toBe(1);
  });

  it('does not throw if the file does not exist', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'nonexistent.db');
    // Should not throw — just logs the error
    expect(() => backupCorruptedDb(dbPath)).not.toThrow();
  });
});

describe('recovery integration', () => {
  it('openDb on corrupt file throws, then backupCorruptedDb + openDb fresh succeeds', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'data.db');
    writeFileSync(dbPath, 'not a database');

    expect(() => openDb(dbPath)).toThrow();

    backupCorruptedDb(dbPath);
    expect(existsSync(dbPath)).toBe(false);

    const db = openDb(dbPath);
    expect(db).toBeDefined();
    const row = db.prepare('SELECT version FROM schema_version').get() as any;
    expect(row.version).toBeGreaterThan(0);
    db.close();
  });
});
