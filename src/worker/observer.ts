/**
 * Multi-turn observer session with durable queue and session resume.
 * Messages are persisted in SQLite so they survive worker crashes.
 * The SDK's session ID is stored so the conversation can be resumed.
 */

import { EventEmitter } from 'events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { parseObservationXml, parseSummaryXml, type ParsedObservation, type ParsedSummary } from './summarizer.js';
import { enqueuePending, claimNextPending, deletePending, getPendingCount, forceUnstickAll, type PendingMessage } from '../db/pending-store.js';
import { setMemorySessionId, getMemorySessionId, storeObservation, storeSummary, getSessionByContentId } from '../db/queries.js';
import { embedObservation } from '../embeddings/embeddings.js';
import { getDb } from '../db/database.js';

// --- Prompts (adapted from claude-mem) ---

const SYSTEM_PROMPT = `You are a specialized observer creating searchable memory FOR FUTURE SESSIONS.

CRITICAL: Record what was LEARNED/BUILT/FIXED/DEPLOYED/CONFIGURED, not what you (the observer) are doing.

You do not have access to tools. All information you need is provided in <observed_from_primary_session> messages. Create observations from what you observe — no investigation needed.

Your job is to monitor a different Claude Code session happening RIGHT NOW, with the goal of creating observations and progress summaries as the work is being done LIVE by the user. You are NOT the one doing the work — you are ONLY observing and recording.

WHAT TO RECORD
--------------
Focus on deliverables and capabilities:
- What the system NOW DOES differently (new capabilities)
- What shipped to users/production (features, fixes, configs, docs)
- Bugs found with root cause analysis
- Non-obvious gotchas and workarounds
- Architecture decisions with rationale
- API behaviors or quirks discovered

Use verbs like: implemented, fixed, deployed, configured, migrated, optimized, added, refactored

GOOD: "Authentication now supports OAuth2 with PKCE flow"
GOOD: "Worker crashes because sqlite-vec isn't loaded before query — fixed by moving loadExtension to init"
BAD: "Analyzed authentication implementation and stored findings"
BAD: "File X was read" / "Function Y was added"

WHEN TO SKIP
------------
Skip routine operations — output nothing if:
- Empty status checks or simple file listings
- Package installations with no errors
- Repetitive operations you've already documented
- File reads that reveal nothing surprising
- Routine edits (import changes, formatting, config tweaks)
- CSS/style-only changes
- Removing debug/logging statements

**No output necessary if skipping.**

OBSERVATION TYPES (use exactly one):
- bugfix: something was broken, now fixed
- feature: new capability added
- refactor: code restructured, behavior unchanged
- discovery: learning about existing system (only if non-obvious insight)
- decision: architectural/design choice with rationale
- change: generic modification (docs, config, misc)

OUTPUT FORMAT
-------------
\`\`\`xml
<observation>
  <type>bugfix | feature | refactor | discovery | decision | change</type>
  <title>Short title capturing the core action (5-10 words)</title>
  <facts>
    <fact>Concise self-contained statement with specifics (filenames, values)</fact>
    <fact>Another specific fact</fact>
  </facts>
  <narrative>What was done, how it works, why it matters (2-3 sentences)</narrative>
  <files_read>
    <file>path/to/file</file>
  </files_read>
  <files_modified>
    <file>path/to/file</file>
  </files_modified>
</observation>
\`\`\`

IMPORTANT: Never reference yourself or your own actions. Do not output anything other than the observation XML. Spend your tokens wisely on useful observations. If there's nothing worth recording, output nothing.`;

function buildInitPrompt(project: string, userPrompt?: string): string {
  return `MEMORY PROCESSING START
=======================
Session started for project: ${project}
${userPrompt ? `User request: ${userPrompt}` : ''}`;
}

function buildObservationPrompt(toolName: string, toolInput: string, toolResponse: string, cwd?: string): string {
  return `<observed_from_primary_session>
  <what_happened>${toolName}</what_happened>
  <occurred_at>${new Date().toISOString()}</occurred_at>${cwd ? `\n  <working_directory>${cwd}</working_directory>` : ''}
  <parameters>${truncate(toolInput, 2000)}</parameters>
  <outcome>${truncate(toolResponse, 3000)}</outcome>
</observed_from_primary_session>`;
}

function buildSummaryPrompt(lastAssistantMessage: string): string {
  return `--- MODE SWITCH: PROGRESS SUMMARY ---
Do NOT output <observation> tags. This is a summary request, not an observation request.
Your response MUST use <summary> tags ONLY.

Write progress notes of what was done, what was learned, and what's next.

Claude's Full Response to User:
${truncate(lastAssistantMessage, 5000)}

Respond in this XML format:
<summary>
  <request>What the user originally asked for</request>
  <investigated>What was explored or researched</investigated>
  <learned>Key findings or discoveries</learned>
  <completed>What was actually done/implemented</completed>
  <next_steps>What remains to be done</next_steps>
</summary>

Output ONLY the summary XML, nothing else.`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '... [truncated]';
}

// --- DurableQueue: SQLite-backed async iterator ---

const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_RESTARTS = 3;

class DurableQueue {
  private emitter = new EventEmitter();
  private closed = false;
  private contentSessionId: string;
  private signal?: AbortSignal;

  constructor(contentSessionId: string, signal?: AbortSignal) {
    this.contentSessionId = contentSessionId;
    this.signal = signal;
  }

  push(kind: 'observation' | 'summary', prompt: string): number {
    const id = enqueuePending(this.contentSessionId, kind, prompt);
    this.emitter.emit('message');
    return id;
  }

  close(): void {
    this.closed = true;
    this.emitter.emit('message'); // wake any waiting iterator
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<PendingMessage> {
    while (!this.closed && !this.signal?.aborted) {
      let msg: PendingMessage | null = null;
      try {
        msg = claimNextPending(this.contentSessionId);
      } catch (err) {
        console.error('[queue] Error claiming message, backing off:', err);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (msg) {
        yield msg;
        continue;
      }

      // Wait for new message or timeout
      const gotMessage = await new Promise<boolean>((resolve) => {
        const onMessage = () => {
          clearTimeout(timer);
          this.signal?.removeEventListener('abort', onAbort);
          resolve(true);
        };
        const onAbort = () => {
          clearTimeout(timer);
          this.emitter.removeListener('message', onMessage);
          resolve(false);
        };
        const timer = setTimeout(() => {
          this.emitter.removeListener('message', onMessage);
          this.signal?.removeEventListener('abort', onAbort);
          resolve(false);
        }, IDLE_TIMEOUT_MS);

        this.emitter.once('message', onMessage);
        this.signal?.addEventListener('abort', onAbort, { once: true });
      });

      if (!gotMessage) {
        if (this.signal?.aborted) break;
        // Final check: stuck messages may now be past STUCK_TIMEOUT_MS
        const recovered = claimNextPending(this.contentSessionId);
        if (recovered) {
          yield recovered;
          continue;
        }
        break;
      }
    }
  }
}

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

  readonly contentSessionId: string;
  readonly project: string;

  constructor(contentSessionId: string, project: string, userPrompt?: string, memorySessionId?: string | null, restartCount: number = 0) {
    this.contentSessionId = contentSessionId;
    this.project = project;
    this.memorySessionId = memorySessionId || null;
    this.restartCount = restartCount;
    this.queue = new DurableQueue(contentSessionId, this.abortController.signal);

    this.runConversation(project, userPrompt);
  }

  async pushObservation(
    toolName: string, toolInput: string, toolResponse: string, cwd?: string
  ): Promise<ParsedObservation | null> {
    if (this.destroyed) return null;

    const prompt = buildObservationPrompt(toolName, toolInput, toolResponse, cwd);
    const pendingId = this.queue.push('observation', prompt);

    return new Promise<ParsedObservation | null>((resolve) => {
      this.pendingResults.set(pendingId, { resolve: resolve as any });
    });
  }

  async pushSummary(lastAssistantMessage: string): Promise<ParsedSummary | null> {
    if (this.destroyed) return null;

    const prompt = buildSummaryPrompt(lastAssistantMessage);
    const pendingId = this.queue.push('summary', prompt);

    return new Promise<ParsedSummary | null>((resolve) => {
      this.pendingResults.set(pendingId, { resolve: resolve as any });
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController.abort();
    this.queue.close();

    for (const [, pending] of this.pendingResults) {
      pending.resolve(null);
    }
    this.pendingResults.clear();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  private async runConversation(project: string, userPrompt?: string): Promise<void> {
    let currentPendingMsg: PendingMessage | null = null;
    const isResume = !!this.memorySessionId;

    try {
      const self = this;
      const messageGenerator = async function* () {
        // First message: init prompt (only if not resuming)
        if (!isResume) {
          yield buildInitPrompt(project, userPrompt);
        }

        // Messages from durable queue
        for await (const msg of self.queue) {
          currentPendingMsg = msg;
          yield msg.prompt;
        }
      }();

      const queryOptions: any = {
        model: 'claude-sonnet-4-6',
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 0,
        tools: [],
        disallowedTools: ['*'],
      };

      // Resume existing conversation if we have a memory session ID
      const queryArgs: any = { prompt: messageGenerator, options: queryOptions };
      if (this.memorySessionId) {
        queryArgs.resume = this.memorySessionId;
        console.log(`[observer] Resuming session ${this.contentSessionId} with memorySessionId`);
      }

      const conversation = query(queryArgs);

      for await (const message of conversation) {
        // Capture memory session ID from first assistant message
        if (message.type === 'assistant' && !this.memorySessionId) {
          const sessionId = (message as any).session_id || (message as any).message?.session_id;
          if (sessionId) {
            this.memorySessionId = sessionId;
            setMemorySessionId(this.contentSessionId, sessionId);
            console.log(`[observer] Captured memorySessionId for ${this.contentSessionId}`);
          }
        }

        // Process assistant response
        if (message.type === 'assistant' && (message as any).message?.content) {
          let text = '';
          for (const block of (message as any).message.content) {
            if (block.type === 'text') text += block.text;
          }

          if (currentPendingMsg && text) {
            this.resolveAndCleanup(currentPendingMsg, text);
            currentPendingMsg = null;
          }
        }

        if (message.type === 'result' && (message as any).subtype === 'success') {
          const text = (message as any).result || '';
          if (currentPendingMsg && text) {
            this.resolveAndCleanup(currentPendingMsg, text);
            currentPendingMsg = null;
          }
        }
      }
    } catch (error) {
      console.error('[observer] Conversation error:', error);
    } finally {
      if (currentPendingMsg) {
        this.resolveAndCleanup(currentPendingMsg, '');
      }
      console.log(`[observer] Conversation ended for ${this.contentSessionId}`);

      // Auto-restart if pending messages remain
      const remainingCount = getPendingCount(this.contentSessionId);
      if (remainingCount > 0 && this.restartCount < MAX_RESTARTS) {
        console.log(`[observer] ${remainingCount} pending messages remain, restarting (${this.restartCount + 1}/${MAX_RESTARTS})`);
        forceUnstickAll(this.contentSessionId);

        // Create replacement BEFORE destroying old session to avoid
        // a window where getObserver() returns undefined
        const replacement = new ObserverSession(
          this.contentSessionId, this.project, undefined,
          this.memorySessionId, this.restartCount + 1,
        );
        activeSessions.set(this.contentSessionId, replacement);

        // Now safe to tear down old session
        this.destroyed = true;
        this.abortController.abort();
        this.queue.close();
        for (const [, pending] of this.pendingResults) {
          pending.resolve(null);
        }
        this.pendingResults.clear();
      } else {
        if (remainingCount > 0) {
          console.warn(`[observer] ${remainingCount} pending messages remain but max restarts (${MAX_RESTARTS}) exceeded`);
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
                .catch(err => console.error('[observer] embedding failed:', err));
            }
          } catch (err) {
            console.error('[observer] Failed to store observation:', err);
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
            console.error('[observer] Failed to store summary:', err);
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

export function getOrCreateObserver(contentSessionId: string, project: string, userPrompt?: string): ObserverSession {
  let session = activeSessions.get(contentSessionId);
  if (session && !session.isDestroyed()) return session;

  // Check for resume: do we have a memory session ID from a previous worker run?
  const memorySessionId = getMemorySessionId(contentSessionId);
  const hasPending = getPendingCount(contentSessionId) > 0;

  if (memorySessionId) {
    if (hasPending) {
      const unstuck = forceUnstickAll(contentSessionId);
      if (unstuck > 0) console.log(`[observer] Force-unstuck ${unstuck} messages for ${contentSessionId}`);
    }
    console.log(`[observer] Recovering session ${contentSessionId} (memorySessionId found, ${hasPending ? 'has' : 'no'} pending)`);
  }

  session = new ObserverSession(contentSessionId, project, userPrompt, memorySessionId);
  activeSessions.set(contentSessionId, session);
  console.log(`[observer] Created session for ${contentSessionId} (project: ${project})`);
  return session;
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
    console.log(`[observer] Destroyed session for ${contentSessionId}`);
  }
}

export function destroyAllObservers(): void {
  for (const [, session] of activeSessions) {
    session.destroy();
  }
  activeSessions.clear();
}
