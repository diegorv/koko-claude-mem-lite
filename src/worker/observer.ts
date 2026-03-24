/**
 * Multi-turn observer session.
 * Maintains a long-lived conversation with Claude via the Agent SDK,
 * so the observer has full context of what it already observed in the session.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { parseObservationXml, parseSummaryXml, type ParsedObservation, type ParsedSummary } from './summarizer.js';

// --- AsyncQueue: simple async iterable queue ---

class AsyncQueue<T> {
  private buffer: T[] = [];
  private resolve: ((value: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  close(): void {
    this.closed = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined as any, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolve = resolve;
        });
      },
    };
  }
}

// --- Prompts (adapted from claude-mem's code.json) ---

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
  return `${SYSTEM_PROMPT}

MEMORY PROCESSING START
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

Write progress notes of what was done, what was learned, and what's next. This is a checkpoint to capture progress so far.

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

// --- Observer Message Types ---

interface ObservationMessage {
  kind: 'observation';
  id: string;
  prompt: string;
}

interface SummaryMessage {
  kind: 'summary';
  id: string;
  prompt: string;
}

type ObserverMessage = ObservationMessage | SummaryMessage;

// --- Pending result tracking ---

interface PendingResult<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

// --- ObserverSession ---

const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export class ObserverSession {
  private queue = new AsyncQueue<ObserverMessage>();
  private pendingObservations = new Map<string, PendingResult<ParsedObservation | null>>();
  private pendingSummaries = new Map<string, PendingResult<ParsedSummary | null>>();
  private conversationPromise: Promise<void>;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private messageCounter = 0;

  readonly contentSessionId: string;
  readonly project: string;

  constructor(contentSessionId: string, project: string, userPrompt?: string) {
    this.contentSessionId = contentSessionId;
    this.project = project;

    // Start the multi-turn conversation
    this.conversationPromise = this.runConversation(project, userPrompt);
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log(`[observer] Session ${this.contentSessionId} idle timeout, destroying`);
      this.destroy();
    }, IDLE_TIMEOUT_MS);
  }

  private nextId(): string {
    return `msg-${++this.messageCounter}`;
  }

  async pushObservation(
    toolName: string,
    toolInput: string,
    toolResponse: string,
    cwd?: string
  ): Promise<ParsedObservation | null> {
    if (this.destroyed) return null;
    this.resetIdleTimer();

    const id = this.nextId();
    const prompt = buildObservationPrompt(toolName, toolInput, toolResponse, cwd);

    return new Promise<ParsedObservation | null>((resolve, reject) => {
      this.pendingObservations.set(id, { resolve, reject });
      this.queue.push({ kind: 'observation', id, prompt });
    });
  }

  async pushSummary(lastAssistantMessage: string): Promise<ParsedSummary | null> {
    if (this.destroyed) return null;
    this.resetIdleTimer();

    const id = this.nextId();
    const prompt = buildSummaryPrompt(lastAssistantMessage);

    return new Promise<ParsedSummary | null>((resolve, reject) => {
      this.pendingSummaries.set(id, { resolve, reject });
      this.queue.push({ kind: 'summary', id, prompt });
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.queue.close();

    // Resolve any pending promises
    for (const [, pending] of this.pendingObservations) {
      pending.resolve(null);
    }
    for (const [, pending] of this.pendingSummaries) {
      pending.resolve(null);
    }
    this.pendingObservations.clear();
    this.pendingSummaries.clear();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  private async runConversation(project: string, userPrompt?: string): Promise<void> {
    // Track which message we're currently processing
    let currentMessage: ObserverMessage | null = null;

    try {
      // Create async generator that yields prompts from the queue
      const messageGenerator = async function* (self: ObserverSession) {
        // First message: init prompt
        yield buildInitPrompt(project, userPrompt);

        // Subsequent messages: from queue
        for await (const msg of self.queue) {
          currentMessage = msg;
          yield msg.prompt;
        }
      }(this);

      const conversation = query({
        prompt: messageGenerator,
        options: {
          model: 'claude-sonnet-4-6',
          systemPrompt: SYSTEM_PROMPT,
          maxTurns: 0, // unlimited — we control via the generator
          tools: [],
          disallowedTools: ['*'],
        },
      });

      for await (const message of conversation) {
        if (message.type === 'assistant' && (message as any).message?.content) {
          let text = '';
          for (const block of (message as any).message.content) {
            if (block.type === 'text') text += block.text;
          }

          if (currentMessage && text) {
            this.resolveMessage(currentMessage, text);
            currentMessage = null;
          }
        }

        if (message.type === 'result' && (message as any).subtype === 'success') {
          const text = (message as any).result || '';
          if (currentMessage && text) {
            this.resolveMessage(currentMessage, text);
            currentMessage = null;
          }
        }
      }
    } catch (error) {
      console.error('[observer] Conversation error:', error);
    } finally {
      // Resolve any remaining pending
      if (currentMessage) {
        this.resolveMessage(currentMessage, '');
      }
      this.destroy();
    }
  }

  private resolveMessage(msg: ObserverMessage, text: string): void {
    if (msg.kind === 'observation') {
      const pending = this.pendingObservations.get(msg.id);
      if (pending) {
        this.pendingObservations.delete(msg.id);
        const parsed = text ? parseObservationXml(text) : null;
        pending.resolve(parsed);
      }
    } else if (msg.kind === 'summary') {
      const pending = this.pendingSummaries.get(msg.id);
      if (pending) {
        this.pendingSummaries.delete(msg.id);
        const parsed = text ? parseSummaryXml(text) : null;
        pending.resolve(parsed);
      }
    }
  }
}

// --- Session Manager ---

const activeSessions = new Map<string, ObserverSession>();

export function getOrCreateObserver(contentSessionId: string, project: string, userPrompt?: string): ObserverSession {
  let session = activeSessions.get(contentSessionId);
  if (session && !session.isDestroyed()) return session;

  session = new ObserverSession(contentSessionId, project, userPrompt);
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
  for (const [id, session] of activeSessions) {
    session.destroy();
  }
  activeSessions.clear();
}
