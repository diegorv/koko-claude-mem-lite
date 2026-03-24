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

const OBSERVATION_SYSTEM_PROMPT = `You are a development session observer. You analyze tool usage events and extract structured observations.

Given a tool use event (tool name, input, output), produce a single XML observation:

\`\`\`xml
<observation>
  <type>discovery | implementation | debugging | architecture</type>
  <title>Short descriptive title (5-10 words)</title>
  <facts>
    <fact>Specific fact learned or action taken</fact>
  </facts>
  <narrative>2-3 sentence summary of what happened and why it matters</narrative>
  <files_read>
    <file>path/to/file</file>
  </files_read>
  <files_modified>
    <file>path/to/file</file>
  </files_modified>
</observation>
\`\`\`

Rules:
- Extract file paths from tool_input and tool_output
- Be concise but capture the important details
- facts should be specific, not generic
- If the tool use is trivial (e.g., listing files), still extract what was discovered
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

const CLEANUP_SYSTEM_PROMPT = `You are a memory quality filter. You review a list of stored observations and summaries and decide which ones are LOW VALUE and should be deleted.

Low-value items include:
- Meta/tooling noise: "Task X updated", "Tool search performed", "Plan mode entered"
- Empty or trivial: "Nothing was done", "No findings", sessions with no real work
- Redundant: near-duplicate entries that repeat the same information
- Generic: observations that contain no specific or actionable information

For each item, output KEEP or DELETE with a brief reason.

Output format (one line per item, in order):
<decisions>
<item id="ID">KEEP|DELETE: reason</item>
</decisions>

Be aggressive about deleting noise. When in doubt about whether something is useful development context, KEEP it. But pure meta-noise should always be DELETED.`;

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

    for await (const message of conversation) {
      // Token-level streaming events
      if (message.type === 'stream_event') {
        const event = (message as any).event;
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          fullText += event.delta.text;
          // Try to parse new complete items from accumulated text
          const partialResults = parseCleanupResults(fullText, items);
          if (partialResults.length > lastParsedCount) {
            for (let i = lastParsedCount; i < partialResults.length; i++) {
              yield { type: 'result', data: partialResults[i] };
            }
            lastParsedCount = partialResults.length;
          }
        }
      }
      // Final result
      if (message.type === 'result' && (message as any).subtype === 'success') {
        fullText = (message as any).result || fullText;
      }
    }

    // Final parse to catch anything missed
    const finalResults = parseCleanupResults(fullText, items);
    if (finalResults.length > lastParsedCount) {
      for (let i = lastParsedCount; i < finalResults.length; i++) {
        yield { type: 'result', data: finalResults[i] };
      }
    }

    yield { type: 'done', data: { results: finalResults, totalReviewed: items.length } };
  } catch (error) {
    console.error('[summarizer] Streaming cleanup failed:', error);
    yield { type: 'done', data: { results: [], error: 'Cleanup failed' } };
  }
}
