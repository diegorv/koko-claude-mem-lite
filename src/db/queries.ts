import { getDb } from './database.js';
import { computeContentHash } from '../utils/hash.js';

const DEDUP_WINDOW_MS = 30_000;

// --- Sessions ---

export interface Session {
  id: number;
  content_session_id: string;
  project: string;
  user_prompt: string | null;
  status: string;
  created_at: string;
  created_at_epoch: number;
}

export function createSession(contentSessionId: string, project: string, prompt?: string): Session {
  const db = getDb();
  const now = Date.now();
  const iso = new Date(now).toISOString();

  db.run(
    `INSERT OR IGNORE INTO sessions (content_session_id, project, user_prompt, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?)`,
    [contentSessionId, project, prompt || null, iso, now]
  );

  // If session already exists, update prompt if provided
  if (prompt) {
    db.run(
      `UPDATE sessions SET user_prompt = ? WHERE content_session_id = ? AND user_prompt IS NULL`,
      [prompt, contentSessionId]
    );
  }

  return db.query('SELECT * FROM sessions WHERE content_session_id = ?').get(contentSessionId) as Session;
}

export function completeSession(contentSessionId: string): void {
  const db = getDb();
  db.run(
    `UPDATE sessions SET status = 'completed' WHERE content_session_id = ?`,
    [contentSessionId]
  );
}

export function getSessionByContentId(contentSessionId: string): Session | null {
  return getDb().query('SELECT * FROM sessions WHERE content_session_id = ?').get(contentSessionId) as Session | null;
}

// --- Observations ---

export interface Observation {
  id: number;
  session_id: number;
  project: string;
  type: string;
  title: string | null;
  facts: string | null;
  narrative: string | null;
  files_read: string | null;
  files_modified: string | null;
  content_hash: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface ObservationInput {
  type: string;
  title: string | null;
  facts: string[];
  narrative: string | null;
  files_read: string[];
  files_modified: string[];
}

export function storeObservation(
  sessionId: number,
  project: string,
  obs: ObservationInput,
  contentSessionId: string
): { id: number; deduplicated: boolean } {
  const db = getDb();
  const now = Date.now();
  const iso = new Date(now).toISOString();

  const contentHash = computeContentHash(contentSessionId, obs.title, obs.narrative);

  // Dedup check
  const existing = db.query(
    'SELECT id FROM observations WHERE content_hash = ? AND created_at_epoch > ?'
  ).get(contentHash, now - DEDUP_WINDOW_MS) as { id: number } | null;

  if (existing) {
    return { id: existing.id, deduplicated: true };
  }

  const result = db.run(
    `INSERT INTO observations (session_id, project, type, title, facts, narrative, files_read, files_modified, content_hash, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId, project, obs.type,
      obs.title,
      JSON.stringify(obs.facts),
      obs.narrative,
      JSON.stringify(obs.files_read),
      JSON.stringify(obs.files_modified),
      contentHash, iso, now
    ]
  );

  return { id: Number(result.lastInsertRowid), deduplicated: false };
}

export function getRecentObservations(project: string, limit: number): Observation[] {
  return getDb().query(
    'SELECT * FROM observations WHERE project = ? ORDER BY created_at_epoch DESC LIMIT ?'
  ).all(project, limit) as Observation[];
}

// --- Summaries ---

export interface Summary {
  id: number;
  session_id: number;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface SummaryInput {
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
}

export function storeSummary(sessionId: number, project: string, summary: SummaryInput): number {
  const db = getDb();
  const now = Date.now();
  const iso = new Date(now).toISOString();

  const result = db.run(
    `INSERT OR REPLACE INTO summaries (session_id, project, request, investigated, learned, completed, next_steps, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId, project,
      summary.request, summary.investigated, summary.learned,
      summary.completed, summary.next_steps,
      iso, now
    ]
  );

  return Number(result.lastInsertRowid);
}

export function getRecentSummaries(project: string, limit: number): Summary[] {
  return getDb().query(
    'SELECT * FROM summaries WHERE project = ? ORDER BY created_at_epoch DESC LIMIT ?'
  ).all(project, limit) as Summary[];
}

// --- Search (FTS5) ---

export interface SearchResult {
  id: number;
  title: string | null;
  narrative: string | null;
  facts: string | null;
  project: string;
  created_at: string;
  rank: number;
}

export function searchObservationsFts(query: string, project?: string, limit: number = 10): SearchResult[] {
  const db = getDb();

  if (project) {
    return db.query(
      `SELECT o.id, o.title, o.narrative, o.facts, o.project, o.created_at, f.rank
       FROM observations_fts f
       JOIN observations o ON o.id = f.rowid
       WHERE observations_fts MATCH ? AND o.project = ?
       ORDER BY f.rank
       LIMIT ?`
    ).all(query, project, limit) as SearchResult[];
  }

  return db.query(
    `SELECT o.id, o.title, o.narrative, o.facts, o.project, o.created_at, f.rank
     FROM observations_fts f
     JOIN observations o ON o.id = f.rowid
     WHERE observations_fts MATCH ?
     ORDER BY f.rank
     LIMIT ?`
  ).all(query, limit) as SearchResult[];
}

// --- Progressive Disclosure Search ---

export interface SearchIndexResult {
  id: number;
  type: string;
  title: string | null;
  narrative: string | null;
  facts: string | null;
  created_at: string;
  rank: number;
}

export interface SearchIndexFilters {
  query: string;
  project?: string;
  type?: string;
  dateStart?: string;
  dateEnd?: string;
  limit?: number;
  offset?: number;
}

export function searchObservationsIndex(filters: SearchIndexFilters): SearchIndexResult[] {
  const db = getDb();
  const limit = filters.limit || 20;
  const offset = filters.offset || 0;

  const conditions: string[] = ['observations_fts MATCH ?'];
  const params: any[] = [filters.query];

  if (filters.project) {
    conditions.push('o.project = ?');
    params.push(filters.project);
  }
  if (filters.type) {
    conditions.push('o.type = ?');
    params.push(filters.type);
  }
  if (filters.dateStart) {
    conditions.push('o.created_at >= ?');
    params.push(filters.dateStart);
  }
  if (filters.dateEnd) {
    conditions.push('o.created_at <= ?');
    params.push(filters.dateEnd);
  }

  params.push(limit, offset);

  return db.query(
    `SELECT o.id, o.type, o.title, o.narrative, o.facts, o.created_at, f.rank
     FROM observations_fts f
     JOIN observations o ON o.id = f.rowid
     WHERE ${conditions.join(' AND ')}
     ORDER BY f.rank
     LIMIT ? OFFSET ?`
  ).all(...params) as SearchIndexResult[];
}

export function getObservationsByIds(ids: number[]): Observation[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  return db.query(
    `SELECT * FROM observations WHERE id IN (${placeholders}) ORDER BY created_at_epoch ASC`
  ).all(...ids) as Observation[];
}

export function getTimelineAroundObservation(
  anchorId: number,
  depthBefore: number = 5,
  depthAfter: number = 5,
  project?: string
): { anchor: Observation | null; before: Observation[]; after: Observation[] } {
  const db = getDb();

  const anchor = db.query('SELECT * FROM observations WHERE id = ?').get(anchorId) as Observation | null;
  if (!anchor) return { anchor: null, before: [], after: [] };

  const projectFilter = project ? 'AND project = ?' : '';
  const projectParams = project ? [project] : [];

  const before = db.query(
    `SELECT * FROM observations
     WHERE created_at_epoch < ? ${projectFilter}
     ORDER BY created_at_epoch DESC LIMIT ?`
  ).all(anchor.created_at_epoch, ...projectParams, depthBefore) as Observation[];

  const after = db.query(
    `SELECT * FROM observations
     WHERE created_at_epoch > ? ${projectFilter}
     ORDER BY created_at_epoch ASC LIMIT ?`
  ).all(anchor.created_at_epoch, ...projectParams, depthAfter) as Observation[];

  return { anchor, before: before.reverse(), after };
}
