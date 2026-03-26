/**
 * Single entry point for all Claude Code hooks.
 * Dispatches based on process.argv[2]: start | context | session-init | observation | summarize | session-end
 */

import { readFileSync } from 'fs';
import { readJsonFromStdin } from './stdin.js';
import { normalizeInput, formatContextOutput, formatSilentOutput } from './adapter.js';
import { stripPrivateTags } from '../utils/privacy.js';
import { getProjectName } from '../utils/paths.js';
import { isProjectExcluded } from '../utils/settings.js';
import { workerFetch, spawnWorker } from './worker-spawn.js';

// --- Worker auto-respawn ---

async function ensureWorkerAndFetch(
  path: string,
  options?: RequestInit,
  retries?: number,
  timeoutMs?: number,
): Promise<Response | null> {
  const res = await workerFetch(path, options, retries, timeoutMs);
  if (res) return res;

  // Worker might be dead — try to respawn and retry
  await spawnWorker();
  return workerFetch(path, options, retries, timeoutMs);
}

// --- Handlers ---

async function handleContext(input: ReturnType<typeof normalizeInput>): Promise<void> {
  const project = getProjectName(input.cwd);

  if (isProjectExcluded(project)) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  const res = await ensureWorkerAndFetch(`/api/context?project=${encodeURIComponent(project)}`);
  if (!res || !res.ok) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  const data = await res.json() as { context: string };
  if (!data.context) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  console.log(JSON.stringify(formatContextOutput(data.context)));
}

async function handleSessionInit(input: ReturnType<typeof normalizeInput>): Promise<void> {
  if (!input.sessionId) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  const project = getProjectName(input.cwd);

  if (isProjectExcluded(project)) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  const prompt = input.prompt ? stripPrivateTags(input.prompt) : undefined;

  await ensureWorkerAndFetch('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ contentSessionId: input.sessionId, project, prompt }),
  });

  console.log(JSON.stringify(formatSilentOutput()));
}

// Tools that are meta/tooling noise — not worth persisting as observations
const IGNORED_TOOLS = new Set([
  'ToolSearch', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop', 'TaskOutput',
  'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion',
  'Skill', 'CronCreate', 'CronDelete', 'CronList',
  'ListMcpResourcesTool', 'ReadMcpResourceTool',
]);

async function handleObservation(input: ReturnType<typeof normalizeInput>): Promise<void> {
  if (!input.sessionId || !input.toolName) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  if (IGNORED_TOOLS.has(input.toolName)) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  const project = getProjectName(input.cwd);
  if (isProjectExcluded(project)) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  const cleanInput = input.toolInput ? stripPrivateTags(input.toolInput) : '';
  const cleanResponse = input.toolResponse ? stripPrivateTags(input.toolResponse) : '';

  // Fire-and-forget: observations are non-critical. Use short timeout with no retries
  // so a slow/stuck worker never blocks Claude Code for more than 3s per tool call.
  await ensureWorkerAndFetch('/api/observations', {
    method: 'POST',
    body: JSON.stringify({
      contentSessionId: input.sessionId,
      tool_name: input.toolName,
      tool_input: cleanInput,
      tool_response: cleanResponse,
      cwd: input.cwd,
    }),
  }, 0, 3_000);

  console.log(JSON.stringify(formatSilentOutput()));
}

async function handleSummarize(input: ReturnType<typeof normalizeInput>): Promise<void> {
  if (!input.sessionId) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  let lastAssistantMessage = '';
  if (input.transcriptPath) {
    try {
      const content = readFileSync(input.transcriptPath, 'utf-8');
      const lines = content.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'assistant' || entry.role === 'assistant') {
            const msg = entry.message?.content || entry.content;
            if (typeof msg === 'string') {
              lastAssistantMessage = msg;
            } else if (Array.isArray(msg)) {
              lastAssistantMessage = msg
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n');
            }
            break;
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* transcript not readable */ }
  }

  await ensureWorkerAndFetch('/api/summarize', {
    method: 'POST',
    body: JSON.stringify({
      contentSessionId: input.sessionId,
      last_assistant_message: lastAssistantMessage,
    }),
  });

  console.log(JSON.stringify(formatSilentOutput()));
}

async function handleSessionEnd(input: ReturnType<typeof normalizeInput>): Promise<void> {
  if (!input.sessionId) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  await ensureWorkerAndFetch('/api/sessions/complete', {
    method: 'POST',
    body: JSON.stringify({ contentSessionId: input.sessionId }),
  });

  console.log(JSON.stringify(formatSilentOutput()));
}

// --- Main ---

async function main(): Promise<void> {
  const event = process.argv[2];
  const raw = await readJsonFromStdin();
  const input = normalizeInput(raw);

  switch (event) {
    case 'start':
      await spawnWorker();
      break;
    case 'context':
      await handleContext(input);
      break;
    case 'session-init':
      await handleSessionInit(input);
      break;
    case 'observation':
      await handleObservation(input);
      break;
    case 'summarize':
      await handleSummarize(input);
      break;
    case 'session-end':
      await handleSessionEnd(input);
      break;
    default:
      console.error(`[hook] Unknown event: ${event}`);
      console.log(JSON.stringify(formatSilentOutput()));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[hook] Fatal error:', err);
    process.exit(1);
  });
