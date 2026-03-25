/**
 * Single entry point for all Claude Code hooks.
 * Dispatches based on process.argv[2]: context | session-init | observation | summarize | session-end
 */

import { readJsonFromStdin } from './stdin.js';
import { normalizeInput, formatContextOutput, formatSilentOutput } from './adapter.js';
import { stripPrivateTags } from '../utils/privacy.js';
import { getProjectName } from '../utils/paths.js';
import { getSetting } from '../utils/settings.js';
import { readFileSync, statSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const WORKER_BASE = `http://127.0.0.1:${getSetting('WORKER_PORT')}`;

async function workerFetch(path: string, options?: RequestInit, retries = 2): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${WORKER_BASE}${path}`, {
        ...options,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...options?.headers },
      });
      clearTimeout(timeout);
      if (res.ok || res.status < 500) return res;
      // Server error — retry
    } catch {
      // Network error or timeout — retry
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${WORKER_BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function waitForReadiness(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${WORKER_BASE}/api/readiness`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function ensureDeps(pluginRoot: string): boolean {
  if (existsSync(join(pluginRoot, 'node_modules', 'better-sqlite3'))) return true;
  try {
    console.error('[memory-lite] Installing dependencies...');
    execSync('npm install --omit=dev', {
      cwd: pluginRoot,
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 120_000,
    });
    console.error('[memory-lite] Dependencies installed.');
    return existsSync(join(pluginRoot, 'node_modules', 'better-sqlite3'));
  } catch (err: any) {
    console.error('[memory-lite] npm install failed:', err.message);
    return false;
  }
}

// --- Handlers ---

async function handleStart(): Promise<void> {
  // Already running?
  if (await waitForHealth(1000)) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  // Anti-spawn-storm: if PID file is recent and process alive, wait for existing spawn
  const pidPath = join(homedir(), '.memory-lite', 'worker.pid');
  try {
    if (existsSync(pidPath)) {
      const ageMs = Date.now() - statSync(pidPath).mtimeMs;
      if (ageMs < 15_000) {
        // Verify the process is actually alive before waiting
        let processAlive = false;
        try {
          const raw = readFileSync(pidPath, 'utf-8').trim();
          const info = JSON.parse(raw);
          process.kill(info.pid, 0); // throws if process doesn't exist
          processAlive = true;
        } catch { /* process dead or PID file unreadable */ }

        if (processAlive) {
          console.error('[memory-lite] PID file is recent and process alive, waiting for existing spawn...');
          if (await waitForReadiness(15_000)) {
            console.log(JSON.stringify(formatSilentOutput()));
            return;
          }
          console.error('[memory-lite] Existing spawn seems to have failed, attempting new spawn');
        } else {
          console.error('[memory-lite] PID file is recent but process dead, spawning new worker');
        }
      }
    }
  } catch { /* ignore PID file read errors */ }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
  const workerScript = join(pluginRoot, 'scripts', 'worker.mjs');

  // Ensure native deps exist before spawning
  if (!ensureDeps(pluginRoot)) {
    console.error('[memory-lite] Cannot start worker: dependencies missing');
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  // Spawn detached worker daemon
  try {
    const child = spawn(process.execPath, [workerScript], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, MEMORY_LITE_PORT: String(getSetting('WORKER_PORT')) },
    });

    if (child.pid === undefined) {
      console.error('[memory-lite] Failed to spawn worker: no PID');
      console.log(JSON.stringify(formatSilentOutput()));
      return;
    }

    child.unref();
  } catch (err: any) {
    console.error('[memory-lite] Failed to spawn worker:', err.message);
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

  // Wait for worker to be fully ready (DB initialized, not just listening)
  const healthy = await waitForReadiness(10_000);
  if (!healthy) {
    console.error('[memory-lite] Worker spawned but health check timed out');
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

  // Skip noisy meta-tools
  if (IGNORED_TOOLS.has(input.toolName)) {
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
    process.exit(1);
  });
