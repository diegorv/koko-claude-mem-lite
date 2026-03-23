/**
 * AI-powered observation extraction and session summarization.
 * Uses @anthropic-ai/sdk for single-turn Claude API calls.
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// --- XML Parser (adapted from claude-mem's src/sdk/parser.ts) ---

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

// --- AI Calls ---

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

export async function extractObservation(
  toolName: string,
  toolInput: string,
  toolResponse: string,
  cwd?: string
): Promise<ParsedObservation | null> {
  try {
    const userMessage = `Tool: ${toolName}
Working directory: ${cwd || 'unknown'}
Input: ${truncate(toolInput, 2000)}
Output: ${truncate(toolResponse, 3000)}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: OBSERVATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return parseObservationXml(text);
  } catch (error) {
    console.error('[summarizer] extractObservation failed:', error);
    return null;
  }
}

export async function generateSummary(lastAssistantMessage: string): Promise<ParsedSummary | null> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: lastAssistantMessage }],
    });

    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return parseSummaryXml(text);
  } catch (error) {
    console.error('[summarizer] generateSummary failed:', error);
    return null;
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '... [truncated]';
}
