/**
 * Single entry point for all Claude Code hooks.
 * Dispatches based on process.argv[2]: context | session-init | observation | summarize | session-end
 */

import { readJsonFromStdin } from './stdin.js';
import { normalizeInput, formatContextOutput, formatSilentOutput } from './adapter.js';
import { stripPrivateTags } from '../utils/privacy.js';
import { getProjectName } from '../utils/paths.js';
import { getSetting } from '../utils/settings.js';
import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const WORKER_BASE = `http://127.0.0.1:${getSetting('WORKER_PORT')}`;

async function workerFetch(path: string, options?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${WORKER_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
  } catch {
    // Worker unavailable — graceful degradation
    return null;
  }
}

async function ensureWorker(): Promise<boolean> {
  const health = await workerFetch('/api/health');
  return health !== null && health.ok;
}

// --- Handlers ---

async function handleStart(): Promise<void> {
  if (await ensureWorker()) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
  const workerScript = join(pluginRoot, 'scripts', 'worker.mjs');

  try {
    const child = spawn('node', [workerScript], {
      stdio: 'ignore',
      detached: true,
      env: process.env,
    });
    child.unref();
    // Wait for worker to be ready
    await new Promise(r => setTimeout(r, 2000));
  } catch {
    // Can't spawn
  }

  console.log(JSON.stringify(formatSilentOutput()));
}

async function handleContext(input: ReturnType<typeof normalizeInput>): Promise<void> {
  const project = getProjectName(input.cwd);

  const res = await workerFetch(`/api/context?project=${encodeURIComponent(project)}`);
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
  const prompt = input.prompt ? stripPrivateTags(input.prompt) : undefined;

  await workerFetch('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ contentSessionId: input.sessionId, project, prompt }),
  });

  console.log(JSON.stringify(formatSilentOutput()));
}

async function handleObservation(input: ReturnType<typeof normalizeInput>): Promise<void> {
  if (!input.sessionId || !input.toolName) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  const cleanInput = input.toolInput ? stripPrivateTags(input.toolInput) : '';
  const cleanResponse = input.toolResponse ? stripPrivateTags(input.toolResponse) : '';

  await workerFetch('/api/observations', {
    method: 'POST',
    body: JSON.stringify({
      contentSessionId: input.sessionId,
      tool_name: input.toolName,
      tool_input: cleanInput,
      tool_response: cleanResponse,
      cwd: input.cwd,
    }),
  });

  console.log(JSON.stringify(formatSilentOutput()));
}

async function handleSummarize(input: ReturnType<typeof normalizeInput>): Promise<void> {
  if (!input.sessionId) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  // Extract last assistant message from transcript
  let lastAssistantMessage = '';
  if (input.transcriptPath) {
    try {
      const content = readFileSync(input.transcriptPath, 'utf-8');
      const lines = content.trim().split('\n');
      // Walk backwards to find last assistant message
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

  await workerFetch('/api/summarize', {
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

  await workerFetch('/api/sessions/complete', {
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
      await handleStart();
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
    process.exit(0); // Always exit 0 for graceful degradation
  });
