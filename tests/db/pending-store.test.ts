import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/db/database.js';

let testDb: Database.Database;

vi.mock('../../src/db/database.js', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return {
    ...orig,
    getDb: () => testDb,
  };
});

import {
  enqueuePending, claimNextPending, deletePending,
  forceUnstickAll, forceUnstickAllGlobal,
  getPendingCount, getSessionsWithPendingMessages,
} from '../../src/db/pending-store.js';

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA_SQL);
});

describe('enqueuePending', () => {
  it('inserts and returns ID', () => {
    const id = enqueuePending('cs-1', 'observation', 'prompt text');
    expect(id).toBeGreaterThan(0);
  });

  it('returns incrementing IDs', () => {
    const id1 = enqueuePending('cs-1', 'observation', 'p1');
    const id2 = enqueuePending('cs-1', 'observation', 'p2');
    expect(id2).toBeGreaterThan(id1);
  });
});

describe('claimNextPending', () => {
  it('returns oldest pending message', () => {
    enqueuePending('cs-1', 'observation', 'first');
    enqueuePending('cs-1', 'observation', 'second');
    const msg = claimNextPending('cs-1');
    expect(msg).not.toBeNull();
    expect(msg!.prompt).toBe('first');
  });

  it('sets status to processing', () => {
    enqueuePending('cs-1', 'observation', 'prompt');
    const msg = claimNextPending('cs-1');
    expect(msg!.status).toBe('processing');
  });

  it('returns null when queue is empty', () => {
    expect(claimNextPending('cs-1')).toBeNull();
  });

  it('does not return already-claimed messages', () => {
    enqueuePending('cs-1', 'observation', 'only one');
    claimNextPending('cs-1');
    expect(claimNextPending('cs-1')).toBeNull();
  });

  it('self-heals stuck messages older than 60s', () => {
    const id = enqueuePending('cs-1', 'observation', 'stuck msg');
    testDb.prepare(
      'UPDATE pending_messages SET status = ?, created_at_epoch = ? WHERE id = ?'
    ).run('processing', Date.now() - 61_000, id);
    const msg = claimNextPending('cs-1');
    expect(msg).not.toBeNull();
    expect(msg!.prompt).toBe('stuck msg');
  });
});

describe('deletePending', () => {
  it('removes message', () => {
    const id = enqueuePending('cs-1', 'observation', 'to delete');
    deletePending(id);
    expect(getPendingCount('cs-1')).toBe(0);
  });
});

describe('forceUnstickAll', () => {
  it('resets processing messages to pending for session', () => {
    enqueuePending('cs-1', 'observation', 'msg');
    claimNextPending('cs-1');
    const count = forceUnstickAll('cs-1');
    expect(count).toBe(1);
    const msg = claimNextPending('cs-1');
    expect(msg).not.toBeNull();
  });

  it('returns 0 when no stuck messages', () => {
    enqueuePending('cs-1', 'observation', 'msg');
    expect(forceUnstickAll('cs-1')).toBe(0);
  });
});

describe('getPendingCount', () => {
  it('returns correct count', () => {
    expect(getPendingCount('cs-1')).toBe(0);
    enqueuePending('cs-1', 'observation', 'a');
    enqueuePending('cs-1', 'observation', 'b');
    expect(getPendingCount('cs-1')).toBe(2);
  });

  it('counts only for the given session', () => {
    enqueuePending('cs-1', 'observation', 'a');
    enqueuePending('cs-2', 'observation', 'b');
    expect(getPendingCount('cs-1')).toBe(1);
  });
});

describe('forceUnstickAllGlobal', () => {
  it('resets all processing messages globally', () => {
    enqueuePending('cs-1', 'observation', 'a');
    enqueuePending('cs-2', 'observation', 'b');
    claimNextPending('cs-1');
    claimNextPending('cs-2');
    const count = forceUnstickAllGlobal();
    expect(count).toBe(2);
  });
});

describe('getSessionsWithPendingMessages', () => {
  it('returns distinct session IDs', () => {
    enqueuePending('cs-1', 'observation', 'a');
    enqueuePending('cs-1', 'observation', 'b');
    enqueuePending('cs-2', 'summary', 'c');
    const sessions = getSessionsWithPendingMessages();
    expect(sessions.sort()).toEqual(['cs-1', 'cs-2']);
  });

  it('returns empty array when no messages', () => {
    expect(getSessionsWithPendingMessages()).toEqual([]);
  });
});

describe('enqueue cap at MAX_PENDING_PER_SESSION', () => {
  it('drops oldest when exceeding 200 pending messages', () => {
    for (let i = 0; i < 200; i++) {
      enqueuePending('cs-1', 'observation', `msg-${i}`);
    }
    expect(getPendingCount('cs-1')).toBe(200);
    enqueuePending('cs-1', 'observation', 'overflow');
    expect(getPendingCount('cs-1')).toBe(200);
    const oldest = testDb.prepare(
      "SELECT prompt FROM pending_messages WHERE content_session_id = 'cs-1' ORDER BY id ASC LIMIT 1"
    ).get() as { prompt: string };
    expect(oldest.prompt).toBe('msg-1');
  });
});
