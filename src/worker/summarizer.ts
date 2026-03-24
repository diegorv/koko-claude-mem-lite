/**
 * AI-powered observation extraction and session summarization.
 * Uses @anthropic-ai/claude-agent-sdk to leverage Claude Code's own authentication
 * (subscription billing) — no separate API key needed.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

// --- XML Parser ---

export interface ParsedObservation {
  type: string;
  title: string | null;
  facts: string[];
  narrative: string | null;
  files_read: string[];
  files_modified: string[];
}

export interface ParsedSummary {
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
}

function extractField(content: string, fieldName: string): string | null {
  const regex = new RegExp(`<${fieldName}>([\\s\\S]*?)</${fieldName}>`);
  const match = regex.exec(content);
  if (!match) return null;
  const trimmed = match[1].trim();
  return trimmed === '' ? null : trimmed;
}

function extractArray(content: string, arrayName: string, elementName: string): string[] {
  const arrayRegex = new RegExp(`<${arrayName}>([\\s\\S]*?)</${arrayName}>`);
  const arrayMatch = arrayRegex.exec(content);
  if (!arrayMatch) return [];

  const elements: string[] = [];
  const elementRegex = new RegExp(`<${elementName}>([\\s\\S]*?)</${elementName}>`, 'g');
  let match;
  while ((match = elementRegex.exec(arrayMatch[1])) !== null) {
    const trimmed = match[1].trim();
    if (trimmed) elements.push(trimmed);
  }
  return elements;
}

function parseObservationXml(text: string): ParsedObservation | null {
  const obsRegex = /<observation>([\s\S]*?)<\/observation>/;
  const match = obsRegex.exec(text);
  if (!match) return null;

  const content = match[1];
  return {
    type: extractField(content, 'type') || 'discovery',
    title: extractField(content, 'title'),
    facts: extractArray(content, 'facts', 'fact'),
    narrative: extractField(content, 'narrative'),
    files_read: extractArray(content, 'files_read', 'file'),
    files_modified: extractArray(content, 'files_modified', 'file'),
  };
}

function parseSummaryXml(text: string): ParsedSummary | null {
  const summaryRegex = /<summary>([\s\S]*?)<\/summary>/;
  const match = summaryRegex.exec(text);
  if (!match) return null;

  const content = match[1];
  return {
    request: extractField(content, 'request'),
    investigated: extractField(content, 'investigated'),
    learned: extractField(content, 'learned'),
    completed: extractField(content, 'completed'),
    next_steps: extractField(content, 'next_steps'),
  };
}

// --- AI Calls via Claude Agent SDK ---

const OBSERVATION_SYSTEM_PROMPT = `You observe a Claude Code session and extract structured observations for FUTURE sessions.

WHAT TO RECORD — focus on deliverables and knowledge:
- What the system NOW DOES differently (new capabilities, fixes, configs)
- Bugs found with root cause ("X broke because Y")
- Non-obvious gotchas and workarounds
- Architecture decisions with rationale
- API behaviors or quirks discovered

WHEN TO SKIP — output nothing if the tool use is:
- Empty status checks, simple file listings, package installs with no errors
- Repetitive operations already documented
- File reads that reveal nothing surprising
- Routine edits with no interesting context (import changes, formatting)
If skipping, output ONLY: <observation><type>skip</type></observation>

TYPES:
- bugfix: something was broken, now fixed
- feature: new capability added
- refactor: code restructured, behavior unchanged
- discovery: learning about existing system (only if non-obvious insight)
- decision: architectural/design choice with rationale
- change: generic modification (docs, config, misc)

FORMAT:
\`\`\`xml
<observation>
  <type>bugfix | feature | refactor | discovery | decision | change</type>
  <title>Short title capturing the core action (5-10 words)</title>
  <facts>
    <fact>Concise self-contained statement with specifics (filenames, values, behaviors)</fact>
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

CRITICAL RULES:
- Record what was LEARNED/BUILT/FIXED, not that you are observing
- NO generic titles like "File X was read" or "Function Y was added" — capture the INSIGHT
- facts must be specific and self-contained (no pronouns, include file paths and values)
- Output ONLY the XML block, nothing else`;

const SUMMARY_SYSTEM_PROMPT = `You are a development session summarizer. Given the last assistant message from a coding session, produce a structured summary.

Output format:
\`\`\`xml
<summary>
  <request>What the user originally asked for</request>
  <investigated>What was explored or researched</investigated>
  <learned>Key findings or discoveries</learned>
  <completed>What was actually done/implemented</completed>
  <next_steps>What remains to be done</next_steps>
</summary>
\`\`\`

Rules:
- Be concise (1-3 sentences per field)
- Focus on actionable information
- Output ONLY the XML block, nothing else`;

/**
 * Run a single-turn query via the Claude Agent SDK.
 * Uses Claude Code's own authentication (subscription billing).
 * Disables all tools so it's a pure text-in/text-out call.
 */
async function runQuery(systemPrompt: string, userMessage: string): Promise<string | null> {
  try {
    const conversation = query({
      prompt: userMessage,
      options: {
        model: 'claude-sonnet-4-6',
        systemPrompt,
        maxTurns: 1,
        tools: [],               // no tools — pure text generation
        disallowedTools: ['*'],   // extra safety: disallow everything
      },
    });

    let resultText = '';
    for await (const message of conversation) {
      if (message.type === 'result' && message.subtype === 'success') {
        resultText = message.result;
      }
    }

    return resultText || null;
  } catch (error) {
    console.error('[summarizer] Agent SDK query failed:', error);
    return null;
  }
}

export async function extractObservation(
  toolName: string,
  toolInput: string,
  toolResponse: string,
  cwd?: string
): Promise<ParsedObservation | null> {
  const userMessage = `Tool: ${toolName}
Working directory: ${cwd || 'unknown'}
Input: ${truncate(toolInput, 2000)}
Output: ${truncate(toolResponse, 3000)}`;

  const text = await runQuery(OBSERVATION_SYSTEM_PROMPT, userMessage);
  if (!text) return null;

  return parseObservationXml(text);
}

export async function generateSummary(lastAssistantMessage: string): Promise<ParsedSummary | null> {
  const text = await runQuery(SUMMARY_SYSTEM_PROMPT, lastAssistantMessage);
  if (!text) return null;

  return parseSummaryXml(text);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '... [truncated]';
}

// --- AI Cleanup ---

const CLEANUP_SYSTEM_PROMPT = `You are an extremely aggressive memory quality filter. Your job is to DELETE everything that won't help a developer in a FUTURE session. Only KEEP observations that contain genuinely actionable technical knowledge.

DELETE (the vast majority of items should be deleted):
- "X was added/created/updated/modified" — knowing a file was edited is useless, the code itself is the source of truth
- "Build succeeded/failed" — ephemeral build status
- "Task/plan created/updated/completed" — meta-tooling noise
- "Tool search performed", "Dependencies found", "File structure explored" — discovery that leads nowhere specific
- "Plugin installed/uninstalled", "Worker started/restarted" — operational noise
- Self-referential observations about the memory plugin itself being developed (unless they contain a real gotcha)
- Summaries of sessions where nothing meaningful was accomplished
- Anything where the title alone tells you everything and there's no deeper insight
- "X function/component/route was implemented" — the code exists, no need to remember it was created
- Redundant entries that repeat information from other items
- CSS/style changes, import changes, config tweaks — trivial mechanical edits

KEEP (only if they contain specific technical knowledge you can't easily re-derive):
- Bugs found with root cause analysis ("X broke because Y")
- Non-obvious gotchas and workarounds ("matcher must be * because resume sessions are missed")
- Architecture decisions with rationale ("chose Hono over Express because ESM compatibility")
- API behaviors or quirks discovered ("Agent SDK doesn't stream tokens despite includePartialMessages")
- Integration issues between systems
- Performance findings with specifics

When in doubt, DELETE. A smaller, high-signal context is far more valuable than a large noisy one.

Output format (one line per item, in order):
<decisions>
<item id="ID">KEEP|DELETE: reason</item>
</decisions>`;

export interface CleanupItem {
  id: number;
  type: 'observation' | 'summary';
  text: string;
}

export interface CleanupResult {
  id: number;
  type: 'observation' | 'summary';
  action: 'keep' | 'delete';
  reason: string;
}

export async function reviewForCleanup(items: CleanupItem[]): Promise<CleanupResult[]> {
  if (items.length === 0) return [];

  const itemList = items.map(i =>
    `[${i.type}#${i.id}] ${i.text}`
  ).join('\n\n');

  const text = await runQuery(CLEANUP_SYSTEM_PROMPT, itemList);
  if (!text) return [];

  return parseCleanupResults(text, items);
}

function parseCleanupResults(text: string, items: CleanupItem[]): CleanupResult[] {
  const results: CleanupResult[] = [];
  const itemRegex = /<item id="(\d+)">(KEEP|DELETE):\s*(.*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(text)) !== null) {
    const id = parseInt(match[1]);
    const item = items.find(i => i.id === id);
    if (item) {
      results.push({
        id,
        type: item.type,
        action: match[2].toLowerCase() as 'keep' | 'delete',
        reason: match[3].trim(),
      });
    }
  }
  return results;
}

/**
 * Streaming cleanup: yields partial results as the AI generates them.
 * Uses includePartialMessages to get token-level streaming from the Agent SDK.
 */
export async function* reviewForCleanupStream(items: CleanupItem[]): AsyncGenerator<{ type: 'result' | 'done'; data: any }> {
  if (items.length === 0) {
    yield { type: 'done', data: { results: [], totalReviewed: 0 } };
    return;
  }

  const itemList = items.map(i =>
    `[${i.type}#${i.id}] ${i.text}`
  ).join('\n\n');

  console.log(`[cleanup] Starting streaming review of ${items.length} items`);

  try {
    const conversation = query({
      prompt: itemList,
      options: {
        model: 'claude-sonnet-4-6',
        systemPrompt: CLEANUP_SYSTEM_PROMPT,
        maxTurns: 1,
        tools: [],
        disallowedTools: ['*'],
        includePartialMessages: true,
      },
    });

    let fullText = '';
    let lastParsedCount = 0;
    let messageCount = 0;

    for await (const message of conversation) {
      messageCount++;
      const msgType = (message as any).type;
      const msgSubtype = (message as any).subtype;

      // Log every message type we see (first 20 only to avoid spam)
      if (messageCount <= 20) {
        console.log(`[cleanup] Message #${messageCount}: type=${msgType} subtype=${msgSubtype}`);
      }

      // Token-level streaming events
      if (msgType === 'stream_event') {
        const event = (message as any).event;
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          fullText += event.delta.text;
          const partialResults = parseCleanupResults(fullText, items);
          if (partialResults.length > lastParsedCount) {
            for (let i = lastParsedCount; i < partialResults.length; i++) {
              console.log(`[cleanup] Yielding result: ${partialResults[i].action} #${partialResults[i].id}`);
              yield { type: 'result', data: partialResults[i] };
            }
            lastParsedCount = partialResults.length;
          }
        }
      }

      // Also check for assistant messages with content (non-streaming fallback)
      if (msgType === 'assistant' && (message as any).message?.content) {
        for (const block of (message as any).message.content) {
          if (block.type === 'text' && block.text) {
            console.log(`[cleanup] Got assistant text block (${block.text.length} chars)`);
            fullText = block.text;
            const partialResults = parseCleanupResults(fullText, items);
            if (partialResults.length > lastParsedCount) {
              for (let i = lastParsedCount; i < partialResults.length; i++) {
                console.log(`[cleanup] Yielding result (from assistant): ${partialResults[i].action} #${partialResults[i].id}`);
                yield { type: 'result', data: partialResults[i] };
              }
              lastParsedCount = partialResults.length;
            }
          }
        }
      }

      // Final result
      if (msgType === 'result') {
        if (msgSubtype === 'success') {
          fullText = (message as any).result || fullText;
          console.log(`[cleanup] Got final result (${fullText.length} chars)`);
        } else {
          console.error(`[cleanup] Result with subtype=${msgSubtype}:`, (message as any).error || 'unknown error');
        }
      }
    }

    console.log(`[cleanup] Stream ended after ${messageCount} messages, fullText=${fullText.length} chars`);

    // Final parse
    const finalResults = parseCleanupResults(fullText, items);
    console.log(`[cleanup] Final parse: ${finalResults.length} results from ${items.length} items`);

    if (finalResults.length > lastParsedCount) {
      for (let i = lastParsedCount; i < finalResults.length; i++) {
        yield { type: 'result', data: finalResults[i] };
      }
    }

    yield { type: 'done', data: { results: finalResults, totalReviewed: items.length } };
  } catch (error) {
    console.error('[cleanup] Streaming cleanup failed:', error);
    yield { type: 'done', data: { results: [], error: String(error) } };
  }
}
