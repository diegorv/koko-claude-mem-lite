import { getDb } from './database.js';

export interface PendingMessage {
  id: number;
  content_session_id: string;
  kind: 'observation' | 'summary';
  prompt: string;
  status: string;
  created_at_epoch: number;
}

const STUCK_TIMEOUT_MS = 60_000;
const MAX_PENDING_PER_SESSION = 200;

export function enqueuePending(contentSessionId: string, kind: 'observation' | 'summary', prompt: string): number {
  const db = getDb();
  const count = getPendingCount(contentSessionId);
  if (count >= MAX_PENDING_PER_SESSION) {
    // Drop oldest pending message to make room
    db.prepare(
      'DELETE FROM pending_messages WHERE id IN (SELECT id FROM pending_messages WHERE content_session_id = ? ORDER BY id ASC LIMIT 1)'
    ).run(contentSessionId);
  }
  const result = db.prepare(
    'INSERT INTO pending_messages (content_session_id, kind, prompt, created_at_epoch) VALUES (?, ?, ?, ?)'
  ).run(contentSessionId, kind, prompt, Date.now());
  return Number(result.lastInsertRowid);
}

export function claimNextPending(contentSessionId: string): PendingMessage | null {
  const db = getDb();

  // Self-heal stuck messages (processing for > 60s)
  db.prepare(
    'UPDATE pending_messages SET status = ? WHERE content_session_id = ? AND status = ? AND created_at_epoch < ?'
  ).run('pending', contentSessionId, 'processing', Date.now() - STUCK_TIMEOUT_MS);

  // Atomic claim: select + update in transaction
  const msg = db.transaction(() => {
    const row = db.prepare(
      'SELECT * FROM pending_messages WHERE content_session_id = ? AND status = ? ORDER BY id ASC LIMIT 1'
    ).get(contentSessionId, 'pending') as PendingMessage | undefined;

    if (!row) return null;

    db.prepare('UPDATE pending_messages SET status = ?, created_at_epoch = ? WHERE id = ?').run('processing', Date.now(), row.id);
    return { ...row, status: 'processing' };
  })();

  return msg;
}

export function deletePending(id: number): void {
  getDb().prepare('DELETE FROM pending_messages WHERE id = ?').run(id);
}

export function forceUnstickAll(contentSessionId: string): number {
  return getDb().prepare(
    'UPDATE pending_messages SET status = ? WHERE content_session_id = ? AND status = ?'
  ).run('pending', contentSessionId, 'processing').changes;
}

export function getPendingCount(contentSessionId: string): number {
  const row = getDb().prepare(
    'SELECT COUNT(*) as count FROM pending_messages WHERE content_session_id = ?'
  ).get(contentSessionId) as { count: number };
  return row.count;
}

/** Reset ALL processing messages to pending (used on startup — SDK context is lost). */
export function forceUnstickAllGlobal(): number {
  return getDb().prepare(
    "UPDATE pending_messages SET status = 'pending' WHERE status = 'processing'"
  ).run().changes;
}

/** Returns distinct session IDs that have any pending or stuck-processing messages. */
export function getSessionsWithPendingMessages(): string[] {
  const rows = getDb().prepare(
    'SELECT DISTINCT content_session_id FROM pending_messages'
  ).all() as { content_session_id: string }[];
  return rows.map(r => r.content_session_id);
}
