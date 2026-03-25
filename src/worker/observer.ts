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
import type { ParsedObservation, ParsedSummary } from './summarizer.js';
import { buildInitPrompt, buildObservationPrompt, buildSummaryPrompt } from './prompts.js';
import { DurableQueue, type PendingMessage } from './durable-queue.js';
import { processMessage, extractAssistantText, type PendingResult } from './message-processor.js';
import { getPendingCount, forceUnstickAll } from '../db/pending-store.js';
import { setMemorySessionId } from '../db/queries.js';
import { logger } from '../utils/logger.js';

// Re-export registry functions so existing imports from './observer.js' still work
export { getOrCreateObserver, getObserver, destroyObserver, destroyAllObservers, getActiveSessionIds, getSessionAge } from './observer-registry.js';

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

export type RegisterObserverFn = (contentSessionId: string, session: ObserverSession) => void;

// --- ObserverSession ---

export class ObserverSession {
  private queue: DurableQueue;
  private pendingResults = new Map<number, PendingResult<ParsedObservation | ParsedSummary | null>>();
  private destroyed = false;
  private memorySessionId: string | null;
  private abortController = new AbortController();
  private restartCount: number;
  private conversation: Query | null = null;
  private onReplace: RegisterObserverFn;
  lastActivityTime: number = Date.now();

  readonly contentSessionId: string;
  readonly project: string;

  constructor(
    contentSessionId: string,
    project: string,
    userPrompt?: string,
    memorySessionId?: string | null,
    restartCount: number = 0,
    onReplace?: RegisterObserverFn,
  ) {
    this.contentSessionId = contentSessionId;
    this.project = project;
    this.memorySessionId = memorySessionId || null;
    this.restartCount = restartCount;
    this.onReplace = onReplace || (() => {});
    this.queue = new DurableQueue(contentSessionId, this.abortController.signal);

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
        if (!isResume) {
          yield toSDKMessage(buildInitPrompt(project, userPrompt));
        }
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

          if ((message as any).session_id && (message as any).session_id !== this.memorySessionId) {
            const prev = this.memorySessionId;
            this.memorySessionId = (message as any).session_id;
            setMemorySessionId(this.contentSessionId, this.memorySessionId!);
            logger.info('observer', `${prev ? 'Updated' : 'Captured'} memorySessionId for ${this.contentSessionId}`);
          }

          if (message.type === 'rate_limit_event') {
            logger.warn('observer', `Rate limited — SDK will retry automatically for ${this.contentSessionId}`);
            continue;
          }

          if (message.type === 'assistant') {
            const text = extractAssistantText(message);

            if (text.length > 0) {
              logger.info('observer', `Assistant response (${text.length} chars) for ${this.contentSessionId}`);
            }

            if (processingMsgs.length > 0 && text) {
              const msg = processingMsgs.shift()!;
              processMessage(msg, text, this.contentSessionId, this.pendingResults);
            }
          }

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
      if (processingMsgs.length > 0) {
        logger.info('observer', `Resolving ${processingMsgs.length} leftover pending msgs with empty text`);
        for (const leftover of processingMsgs) {
          processMessage(leftover, '', this.contentSessionId, this.pendingResults);
        }
        processingMsgs.length = 0;
      }

      const remainingCount = getPendingCount(this.contentSessionId);
      logger.info('observer', `Conversation ended for ${this.contentSessionId} (remaining=${remainingCount}, restarts=${this.restartCount}/${MAX_RESTARTS}, destroyed=${this.destroyed})`);
      if (remainingCount > 0 && this.restartCount < MAX_RESTARTS) {
        logger.info('observer', `${remainingCount} pending messages remain, restarting (${this.restartCount + 1}/${MAX_RESTARTS})`);

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

        const replacement = new ObserverSession(
          this.contentSessionId, this.project, undefined,
          this.memorySessionId, this.restartCount + 1,
          this.onReplace,
        );
        this.onReplace(this.contentSessionId, replacement);
      } else {
        if (remainingCount > 0) {
          logger.warn('observer', `${remainingCount} pending messages remain but max restarts (${MAX_RESTARTS}) exceeded`);
        }
        this.destroy();
      }
    }
  }
}
