/**
 * Manages the lifecycle of ObserverSession instances.
 * Maps content session IDs to active observer sessions.
 */

import { ObserverSession } from './observer.js';
import { getPendingCount, forceUnstickAll } from '../db/pending-store.js';
import { getMemorySessionId, setMemorySessionId } from '../db/queries.js';
import { logger } from '../utils/logger.js';

const MAX_OBSERVERS = 10;

const activeSessions = new Map<string, ObserverSession>();
const creatingSessions = new Set<string>();

export function registerObserver(contentSessionId: string, session: ObserverSession): void {
  activeSessions.set(contentSessionId, session);
}

export function getOrCreateObserver(contentSessionId: string, project: string, userPrompt?: string): ObserverSession {
  let session = activeSessions.get(contentSessionId);
  if (session && !session.isDestroyed()) return session;

  // Guard against duplicate creation from concurrent calls
  if (creatingSessions.has(contentSessionId)) {
    session = activeSessions.get(contentSessionId);
    if (session && !session.isDestroyed()) return session;
  }
  creatingSessions.add(contentSessionId);

  // Evict a session if cap is reached. Prefer sessions with zero pending
  // messages to avoid data loss; fall back to oldest session if all have work.
  if (activeSessions.size >= MAX_OBSERVERS) {
    let evictId: string | null = null;
    let evictTime = Infinity;
    let evictHasPending = true;

    for (const [id, s] of activeSessions) {
      const hasPendingWork = getPendingCount(id) > 0;
      // Prefer idle sessions (no pending) over busy ones; among equals pick oldest
      if ((!hasPendingWork && evictHasPending) ||
          (hasPendingWork === evictHasPending && s.lastActivityTime < evictTime)) {
        evictId = id;
        evictTime = s.lastActivityTime;
        evictHasPending = hasPendingWork;
      }
    }
    if (evictId) {
      logger.warn('observer', `Observer cap (${MAX_OBSERVERS}) reached, evicting session ${evictId} (hasPending=${evictHasPending})`);
      destroyObserver(evictId);
    }
  }

  // CRITICAL (Issue #817 from claude-mem): Never resume with stale memorySessionId.
  const staleMemorySessionId = getMemorySessionId(contentSessionId);
  if (staleMemorySessionId) {
    logger.warn('observer', `Discarding stale memorySessionId for ${contentSessionId} (SDK context lost on worker restart)`);
    setMemorySessionId(contentSessionId, null);
  }

  // Clean up any orphaned pending messages from previous runs
  const hasPending = getPendingCount(contentSessionId) > 0;
  if (hasPending) {
    const unstuck = forceUnstickAll(contentSessionId);
    if (unstuck > 0) logger.info('observer', `Force-unstuck ${unstuck} messages for ${contentSessionId}`);
  }

  try {
    session = new ObserverSession(contentSessionId, project, userPrompt, null, 0, registerObserver);
    activeSessions.set(contentSessionId, session);
    logger.info('observer', `Created session for ${contentSessionId} (project: ${project})`);
    return session;
  } finally {
    creatingSessions.delete(contentSessionId);
  }
}

export function getObserver(contentSessionId: string): ObserverSession | undefined {
  const session = activeSessions.get(contentSessionId);
  if (session?.isDestroyed()) {
    activeSessions.delete(contentSessionId);
    return undefined;
  }
  return session;
}

export function destroyObserver(contentSessionId: string): void {
  const session = activeSessions.get(contentSessionId);
  if (session) {
    session.destroy();
    activeSessions.delete(contentSessionId);
    logger.info('observer', `Destroyed session for ${contentSessionId}`);
  }
}

export function destroyAllObservers(): void {
  for (const [, session] of activeSessions) {
    session.destroy();
  }
  activeSessions.clear();
}

export function getActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys());
}

export function getSessionAge(contentSessionId: string): number {
  const session = activeSessions.get(contentSessionId);
  if (!session) return Infinity;
  return Date.now() - session.lastActivityTime;
}

export function getObserverDetails(): { contentSessionId: string; project: string; lastActivityAge: number }[] {
  return Array.from(activeSessions.entries()).map(([id, s]) => ({
    contentSessionId: id,
    project: s.project,
    lastActivityAge: Date.now() - s.lastActivityTime,
  }));
}
