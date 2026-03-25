/**
 * Manages the lifecycle of ObserverSession instances.
 * Maps content session IDs to active observer sessions.
 */

import { ObserverSession } from './observer.js';
import { getPendingCount, forceUnstickAll } from '../db/pending-store.js';
import { getMemorySessionId } from '../db/queries.js';
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

  // Evict oldest session if cap is reached to prevent unbounded process accumulation
  if (activeSessions.size >= MAX_OBSERVERS) {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, s] of activeSessions) {
      if (s.lastActivityTime < oldestTime) {
        oldestTime = s.lastActivityTime;
        oldestId = id;
      }
    }
    if (oldestId) {
      logger.warn('observer', `Observer cap (${MAX_OBSERVERS}) reached, evicting oldest session ${oldestId}`);
      destroyObserver(oldestId);
    }
  }

  // CRITICAL (Issue #817 from claude-mem): Never resume with stale memorySessionId.
  const staleMemorySessionId = getMemorySessionId(contentSessionId);
  if (staleMemorySessionId) {
    logger.warn('observer', `Discarding stale memorySessionId for ${contentSessionId} (SDK context lost on worker restart)`);
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
