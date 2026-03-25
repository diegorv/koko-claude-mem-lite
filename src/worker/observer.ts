/**
 * Multi-turn observer session with durable queue and session resume.
 * Messages are persisted in SQLite so they survive worker crashes.
 * The SDK's session ID is stored so the conversation can be resumed.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { parseObservationXml, parseSummaryXml, type ParsedObservation, type ParsedSummary } from './summarizer.js';
import { buildInitPrompt, buildObservationPrompt, buildSummaryPrompt } from './prompts.js';
import { DurableQueue, type PendingMessage } from './durable-queue.js';
import { deletePending, getPendingCount, forceUnstickAll } from '../db/pending-store.js';
import { setMemorySessionId, getMemorySessionId, storeObservation, storeSummary, getSessionByContentId } from '../db/queries.js';
import { embedObservation } from '../embeddings/embeddings.js';
import { getDb } from '../db/database.js';
import { logger } from '../utils/logger.js';

// --- SDK environment helpers ---

const OBSERVER_SESSIONS_DIR = join(homedir(), '.memory-lite', 'observer-sessions');

function ensureObserverSessionsDir(): string {
  if (!existsSync(OBSERVER_SESSIONS_DIR)) {
    mkdirSync(OBSERVER_SESSIONS_DIR, { recursive: true });
  }
  return OBSERVER_SESSIONS_DIR;
}

let cachedClaudePath: string | null = null;

function findClaudeExecutable(): string {
  if (cachedClaudePath) return cachedClaudePath;
  try {
    cachedClaudePath = execSync('which claude', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n')[0].trim();
    if (cachedClaudePath) {
      logger.info('observer', `Found claude executable: ${cachedClaudePath}`);
      return cachedClaudePath;
    }
  } catch {
    logger.warn('observer', 'Could not find claude executable via "which claude"');
  }
  return 'claude';
}

const MAX_RESTARTS = 3;

// --- Pending result tracking ---

interface PendingResult<T> {
  resolve: (value: T) => void;
}

// --- ObserverSession ---

export class ObserverSession {
  private queue: DurableQueue;
  private pendingResults = new Map<number, PendingResult<ParsedObservation | ParsedSummary | null>>();
  private destroyed = false;
  private memorySessionId: string | null;
  private abortController = new AbortController();
  private restartCount: number;
  private conversation: Query | null = null;
  lastActivityTime: number = Date.now();

  readonly contentSessionId: string;
  readonly project: string;

  constructor(contentSessionId: string, project: string, userPrompt?: string, memorySessionId?: string | null, restartCount: number = 0) {
    this.contentSessionId = contentSessionId;
    this.project = project;
    this.memorySessionId = memorySessionId || null;
    this.restartCount = restartCount;
    this.queue = new DurableQueue(contentSessionId, this.abortController.signal);

    // Unstick any orphaned processing messages from previous runs
    const unstuck = forceUnstickAll(contentSessionId);
    if (unstuck > 0) logger.info('observer', `Constructor unstuck ${unstuck} messages for ${contentSessionId}`);

    this.runConversation(project, userPrompt);
  }

  async pushObservation(
    toolName: string, toolInput: string, toolResponse: string, cwd?: string
  ): Promise<ParsedObservation | null> {
    if (this.destroyed) return null;
    this.lastActivityTime = Date.now();

    const prompt = buildObservationPrompt(toolName, toolInput, toolResponse, cwd);
    const pendingId = this.queue.push('observation', prompt);

    return new Promise<ParsedObservation | null>((resolve) => {
      this.pendingResults.set(pendingId, { resolve: resolve as any });
    });
  }

  async pushSummary(lastAssistantMessage: string): Promise<ParsedSummary | null> {
    if (this.destroyed) return null;
    this.lastActivityTime = Date.now();

    const prompt = buildSummaryPrompt(lastAssistantMessage);
    const pendingId = this.queue.push('summary', prompt);

    return new Promise<ParsedSummary | null>((resolve) => {
      this.pendingResults.set(pendingId, { resolve: resolve as any });
    });
  }

  destroy(): void {
    if (this.destroyed) {
      logger.info('observer', `destroy() called but already destroyed for ${this.contentSessionId}`);
      return;
    }
    logger.info('observer', `destroy() starting for ${this.contentSessionId} (hasConversation=${!!this.conversation}, pendingResults=${this.pendingResults.size})`);
    this.destroyed = true;
    this.abortController.abort();
    this.queue.close();

    // Kill the SDK subprocess
    if (this.conversation) {
      logger.info('observer', `Closing SDK conversation for ${this.contentSessionId}`);
      try { this.conversation.close(); } catch (err) {
        logger.error('observer', `Error closing conversation for ${this.contentSessionId}`, err);
      }
      this.conversation = null;
    }

    for (const [, pending] of this.pendingResults) {
      pending.resolve(null);
    }
    this.pendingResults.clear();
    logger.info('observer', `destroy() completed for ${this.contentSessionId}`);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  private async runConversation(project: string, userPrompt?: string): Promise<void> {
    // FIFO queue: SDK may pull multiple messages from the generator before responding.
    // Each assistant response is matched to the oldest unresolved message.
    const processingMsgs: PendingMessage[] = [];
    const isResume = !!this.memorySessionId;

    try {
      const self = this;
      const toSDKMessage = (content: string): SDKUserMessage => ({
        type: 'user',
        message: { role: 'user', content },
        session_id: self.contentSessionId,
        parent_tool_use_id: null,
        isSynthetic: true,
      });

      const messageGenerator = async function* () {
        // First message: init prompt with system prompt embedded (only if not resuming)
        if (!isResume) {
          yield toSDKMessage(buildInitPrompt(project, userPrompt));
        }

        // Messages from durable queue
        for await (const msg of self.queue) {
          processingMsgs.push(msg);
          yield toSDKMessage(msg.prompt);
        }
      }();

      const claudePath = findClaudeExecutable();
      const observerCwd = ensureObserverSessionsDir();

      const disallowedTools = [
        'Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob',
        'WebFetch', 'WebSearch', 'Task', 'NotebookEdit',
        'AskUserQuestion', 'TodoWrite',
      ];

      const shouldResume = isResume && this.restartCount === 0;

      logger.info('observer', `Starting SDK query for ${this.contentSessionId} (resume=${shouldResume}, model=claude-sonnet-4-6)`);

      const conversation = query({
        prompt: messageGenerator,
        options: {
          model: 'claude-sonnet-4-6',
          cwd: observerCwd,
          ...(shouldResume && this.memorySessionId && { resume: this.memorySessionId }),
          disallowedTools,
          abortController: this.abortController,
          pathToClaudeCodeExecutable: claudePath,
        },
      });

      this.conversation = conversation;

      // Idle timeout: if no SDK messages for 5 min, force-close
      const QUERY_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
      let lastMessageTime = Date.now();
      let sdkMessageCount = 0;
      const idleChecker = setInterval(() => {
        const idleMs = Date.now() - lastMessageTime;
        logger.info('observer', `SDK idle check for ${this.contentSessionId}: ${Math.round(idleMs / 1000)}s since last message, ${sdkMessageCount} total messages`);
        if (idleMs > QUERY_IDLE_TIMEOUT_MS) {
          logger.warn('observer', `SDK query idle timeout for ${this.contentSessionId}, aborting`);
          this.abortController.abort();
          if (this.conversation) {
            try { this.conversation.close(); } catch {}
          }
        }
      }, 30_000);
      idleChecker.unref();

      try {
        logger.info('observer', `Entering SDK for-await loop for ${this.contentSessionId}`);
        for await (const message of conversation) {
          sdkMessageCount++;
          lastMessageTime = Date.now();
          logger.info('observer', `SDK message #${sdkMessageCount} type=${message.type} for ${this.contentSessionId}`);

          // Capture or update memory session ID from ANY message (like claude-mem)
          // The SDK may return a different session_id on resume
          if ((message as any).session_id && (message as any).session_id !== this.memorySessionId) {
            const prev = this.memorySessionId;
            this.memorySessionId = (message as any).session_id;
            setMemorySessionId(this.contentSessionId, this.memorySessionId!);
            logger.info('observer', `${prev ? 'Updated' : 'Captured'} memorySessionId for ${this.contentSessionId}`);
          }

          // Handle assistant messages (extract text exactly like claude-mem)
          if (message.type === 'assistant') {
            const content = (message as any).message?.content;
            const text = Array.isArray(content)
              ? content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
              : typeof content === 'string' ? content : '';

            if (text.length > 0) {
              logger.info('observer', `Assistant response (${text.length} chars) for ${this.contentSessionId}`);
            }

            if (processingMsgs.length > 0 && text) {
              const msg = processingMsgs.shift()!;
              this.resolveAndCleanup(msg, text);
            }
          }

          // Log result messages
          if (message.type === 'result') {
            logger.info('observer', `Result for ${this.contentSessionId}: subtype=${(message as any).subtype}`);
          }
        }
      } catch (err) {
        logger.error('observer', `SDK for-await loop error for ${this.contentSessionId}`, err);
        throw err;
      } finally {
        clearInterval(idleChecker);
        this.conversation = null;
        logger.info('observer', `SDK for-await loop exited for ${this.contentSessionId} (${sdkMessageCount} messages processed)`);
      }
    } catch (error) {
      logger.error('observer', `Conversation error for ${this.contentSessionId}`, error);
    } finally {
      // Resolve any messages the SDK never responded to
      if (processingMsgs.length > 0) {
        logger.info('observer', `Resolving ${processingMsgs.length} leftover pending msgs with empty text`);
        for (const leftover of processingMsgs) {
          this.resolveAndCleanup(leftover, '');
        }
        processingMsgs.length = 0;
      }

      // Auto-restart if pending messages remain
      const remainingCount = getPendingCount(this.contentSessionId);
      logger.info('observer', `Conversation ended for ${this.contentSessionId} (remaining=${remainingCount}, restarts=${this.restartCount}/${MAX_RESTARTS}, destroyed=${this.destroyed})`);
      if (remainingCount > 0 && this.restartCount < MAX_RESTARTS) {
        logger.info('observer', `${remainingCount} pending messages remain, restarting (${this.restartCount + 1}/${MAX_RESTARTS})`);

        // Tear down old session FIRST to prevent zombie SDK subprocesses
        this.destroyed = true;
        this.abortController.abort();
        this.queue.close();
        if (this.conversation) {
          try { this.conversation.close(); } catch {}
          this.conversation = null;
        }
        for (const [, pending] of this.pendingResults) {
          pending.resolve(null);
        }
        this.pendingResults.clear();

        forceUnstickAll(this.contentSessionId);

        // Create replacement after old subprocess is cleaned up
        const replacement = new ObserverSession(
          this.contentSessionId, this.project, undefined,
          this.memorySessionId, this.restartCount + 1,
        );
        activeSessions.set(this.contentSessionId, replacement);
      } else {
        if (remainingCount > 0) {
          logger.warn('observer', `${remainingCount} pending messages remain but max restarts (${MAX_RESTARTS}) exceeded`);
        }
        this.destroy();
      }
    }
  }

  private resolveAndCleanup(msg: PendingMessage, text: string): void {
    if (msg.kind === 'observation' && text) {
      const parsed = parseObservationXml(text);
      if (parsed && parsed.type !== 'skip') {
        const session = getSessionByContentId(this.contentSessionId);
        if (session) {
          try {
            const result = storeObservation(session.id, session.project, parsed, this.contentSessionId);
            // Delete from durable store only AFTER successful storage
            deletePending(msg.id);
            if (!result.deduplicated) {
              embedObservation(getDb(), result.id, parsed.title, parsed.narrative, parsed.facts)
                .catch(err => logger.error('observer', 'embedding failed', err));
            }
          } catch (err) {
            logger.error('observer', 'Failed to store observation', err);
            // Don't delete pending — will be retried on next restart
            return;
          }
        } else {
          deletePending(msg.id);
        }
      } else {
        deletePending(msg.id);
      }
      // Resolve pending promise (for any callers still awaiting)
      const pending = this.pendingResults.get(msg.id);
      if (pending) {
        this.pendingResults.delete(msg.id);
        pending.resolve(parsed ?? null);
      }
    } else if (msg.kind === 'summary' && text) {
      const parsed = parseSummaryXml(text);
      if (parsed) {
        const session = getSessionByContentId(this.contentSessionId);
        if (session) {
          try {
            storeSummary(session.id, session.project, parsed);
            // Delete from durable store only AFTER successful storage
            deletePending(msg.id);
          } catch (err) {
            logger.error('observer', 'Failed to store summary', err);
            // Don't delete pending — will be retried on next restart
            return;
          }
        } else {
          deletePending(msg.id);
        }
      } else {
        deletePending(msg.id);
      }
      const pending = this.pendingResults.get(msg.id);
      if (pending) {
        this.pendingResults.delete(msg.id);
        pending.resolve(parsed ?? null);
      }
    } else {
      // Empty text — nothing to store, safe to delete
      deletePending(msg.id);
      const pending = this.pendingResults.get(msg.id);
      if (pending) {
        this.pendingResults.delete(msg.id);
        pending.resolve(null);
      }
    }
  }
}

// --- Session Manager ---

const activeSessions = new Map<string, ObserverSession>();
const creatingSessions = new Set<string>();

export function getOrCreateObserver(contentSessionId: string, project: string, userPrompt?: string): ObserverSession {
  let session = activeSessions.get(contentSessionId);
  if (session && !session.isDestroyed()) return session;

  // Guard against duplicate creation from concurrent calls
  if (creatingSessions.has(contentSessionId)) {
    session = activeSessions.get(contentSessionId);
    if (session && !session.isDestroyed()) return session;
  }
  creatingSessions.add(contentSessionId);

  // CRITICAL (Issue #817 from claude-mem): Never resume with stale memorySessionId.
  // When creating a new in-memory session, any DB memorySessionId is STALE because
  // the SDK context was lost when the worker restarted. Always start fresh —
  // the SDK will capture a new memorySessionId on the first response.
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
    session = new ObserverSession(contentSessionId, project, userPrompt, null);
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
