/**
 * AI-powered observation extraction and session summarization.
 * Uses @anthropic-ai/claude-agent-sdk to leverage Claude Code's own authentication
 * (subscription billing) — no separate API key needed.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { parseObservationXml, parseSummaryXml } from './xml-parser.js';
import { OBSERVATION_EXTRACTION_PROMPT, SUMMARY_SYSTEM_PROMPT, CLEANUP_SYSTEM_PROMPT, truncate } from './prompts.js';
import { logger } from '../utils/logger.js';

export { parseObservationXml, parseSummaryXml } from './xml-parser.js';
export type { ParsedObservation, ParsedSummary } from './xml-parser.js';

// --- AI Calls via Claude Agent SDK ---

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
    logger.error('summarizer', 'Agent SDK query failed', error);
    return null;
  }
}

export async function extractObservation(
  toolName: string,
  toolInput: string,
  toolResponse: string,
  cwd?: string
): Promise<ReturnType<typeof parseObservationXml>> {
  const userMessage = `Tool: ${toolName}
Working directory: ${cwd || 'unknown'}
Input: ${truncate(toolInput, 2000)}
Output: ${truncate(toolResponse, 3000)}`;

  const text = await runQuery(OBSERVATION_EXTRACTION_PROMPT, userMessage);
  if (!text) return null;

  return parseObservationXml(text);
}

export async function generateSummary(lastAssistantMessage: string): Promise<ReturnType<typeof parseSummaryXml>> {
  const text = await runQuery(SUMMARY_SYSTEM_PROMPT, lastAssistantMessage);
  if (!text) return null;

  return parseSummaryXml(text);
}

// --- AI Cleanup ---

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

export function parseCleanupResults(text: string, items: CleanupItem[]): CleanupResult[] {
  logger.debug('cleanup', `Raw AI response (${text.length} chars):\n${text}`);

  const results: CleanupResult[] = [];
  const seen = new Set<string>();
  const itemRegex = /<item id="(?:(observation|summary)#)?(\d+)">(KEEP|DELETE):\s*(.*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(text)) !== null) {
    const typeHint = match[1] as 'observation' | 'summary' | undefined;
    const id = parseInt(match[2]);
    const item = typeHint
      ? items.find(i => i.id === id && i.type === typeHint)
      : items.find(i => i.id === id);
    if (!item) {
      logger.warn('cleanup', `No matching item for id=${id} type=${typeHint ?? 'any'}, skipping`);
      continue;
    }
    const key = `${item.type}-${item.id}`;
    if (seen.has(key)) {
      logger.warn('cleanup', `Duplicate result for ${key}, skipping`);
      continue;
    }
    seen.add(key);
    const result: CleanupResult = {
      id,
      type: item.type,
      action: match[3].toLowerCase() as 'keep' | 'delete',
      reason: match[4].trim(),
    };
    logger.debug('cleanup', `Parsed: ${key} → ${result.action}: ${result.reason}`);
    results.push(result);
  }

  logger.info('cleanup', `Parsed ${results.length} results from ${items.length} items`);
  return results;
}
