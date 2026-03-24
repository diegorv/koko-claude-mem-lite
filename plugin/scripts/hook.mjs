#!/usr/bin/env node

// src/hooks/stdin.ts
var SAFETY_TIMEOUT_MS = 3e4;
var PARSE_DELAY_MS = 50;
function isStdinAvailable() {
  try {
    const stdin = process.stdin;
    if (stdin.isTTY) return false;
    stdin.readable;
    return true;
  } catch {
    return false;
  }
}
function tryParseJson(input) {
  const trimmed = input.trim();
  if (!trimmed) return void 0;
  try {
    return JSON.parse(trimmed);
  } catch {
    return void 0;
  }
}
async function readJsonFromStdin() {
  if (!isStdinAvailable()) return void 0;
  return new Promise((resolve) => {
    let input = "";
    let resolved = false;
    let parseDelayId = null;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      if (parseDelayId) clearTimeout(parseDelayId);
      clearTimeout(safetyTimeoutId);
      try {
        process.stdin.removeAllListeners("data");
        process.stdin.removeAllListeners("end");
        process.stdin.removeAllListeners("error");
      } catch {
      }
      resolve(value);
    };
    const tryResolve = () => {
      const parsed = tryParseJson(input);
      if (parsed !== void 0) {
        done(parsed);
        return true;
      }
      return false;
    };
    const safetyTimeoutId = setTimeout(() => {
      if (!resolved) {
        if (!tryResolve()) done(void 0);
      }
    }, SAFETY_TIMEOUT_MS);
    try {
      process.stdin.on("data", (chunk) => {
        input += chunk;
        if (parseDelayId) {
          clearTimeout(parseDelayId);
          parseDelayId = null;
        }
        if (tryResolve()) return;
        parseDelayId = setTimeout(tryResolve, PARSE_DELAY_MS);
      });
      process.stdin.on("end", () => {
        if (!resolved) {
          if (!tryResolve()) done(void 0);
        }
      });
      process.stdin.on("error", () => {
        if (!resolved) done(void 0);
      });
    } catch {
      resolved = true;
      clearTimeout(safetyTimeoutId);
      resolve(void 0);
    }
  });
}

// src/hooks/adapter.ts
function normalizeInput(raw) {
  const r = raw ?? {};
  return {
    sessionId: r.session_id ?? r.id ?? r.sessionId,
    cwd: r.cwd || process.cwd(),
    prompt: r.prompt,
    toolName: r.tool_name,
    toolInput: typeof r.tool_input === "string" ? r.tool_input : JSON.stringify(r.tool_input ?? ""),
    toolResponse: typeof r.tool_response === "string" ? r.tool_response : JSON.stringify(r.tool_response ?? ""),
    transcriptPath: r.transcript_path
  };
}
function formatContextOutput(context) {
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context
    }
  };
}
function formatSilentOutput() {
  return {};
}

// src/utils/privacy.ts
function stripPrivateTags(content) {
  return content.replace(/<memory-lite-context>[\s\S]*?<\/memory-lite-context>/g, "").replace(/<private>[\s\S]*?<\/private>/g, "").trim();
}

// src/utils/paths.ts
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
var DATA_DIR = join(homedir(), ".memory-lite");
function getDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
}
function getSettingsPath() {
  return join(getDataDir(), "settings.json");
}
function getProjectName(cwd) {
  return cwd.split("/").pop() || "unknown";
}

// src/utils/settings.ts
import { existsSync as existsSync2, readFileSync, writeFileSync } from "fs";
var DEFAULTS = {
  WORKER_PORT: 37888,
  OBSERVATION_COUNT: 50,
  FULL_OBSERVATION_COUNT: 5,
  SUMMARY_COUNT: 3,
  OLLAMA_URL: "http://localhost:11434",
  OLLAMA_MODEL: "bge-m3"
};
var cached = null;
function getSettings() {
  if (cached) return cached;
  const path = getSettingsPath();
  if (!existsSync2(path)) {
    writeFileSync(path, JSON.stringify(DEFAULTS, null, 2));
    cached = { ...DEFAULTS };
    return cached;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    cached = { ...DEFAULTS, ...raw };
    return cached;
  } catch {
    cached = { ...DEFAULTS };
    return cached;
  }
}
function getSetting(key) {
  const envVal = process.env[`MEMORY_LITE_${key}`];
  if (envVal !== void 0) {
    const def = DEFAULTS[key];
    if (typeof def === "number") return Number(envVal);
    return envVal;
  }
  return getSettings()[key];
}

// src/hooks/hook.ts
import { readFileSync as readFileSync2, statSync } from "fs";
import { spawn, execSync } from "child_process";
import { join as join2, dirname } from "path";
import { existsSync as existsSync3 } from "fs";
import { fileURLToPath } from "url";
import { homedir as homedir2 } from "os";
var WORKER_BASE = `http://127.0.0.1:${getSetting("WORKER_PORT")}`;
async function workerFetch(path, options) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1e4);
    const res = await fetch(`${WORKER_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...options?.headers }
    });
    clearTimeout(timeout);
    return res;
  } catch {
    return null;
  }
}
async function waitForHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${WORKER_BASE}/api/health`, { signal: AbortSignal.timeout(1e3) });
      if (res.ok) return true;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
async function waitForReadiness(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${WORKER_BASE}/api/readiness`, { signal: AbortSignal.timeout(1e3) });
      if (res.ok) return true;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
function ensureDeps(pluginRoot) {
  if (existsSync3(join2(pluginRoot, "node_modules", "better-sqlite3"))) return true;
  try {
    console.error("[memory-lite] Installing dependencies...");
    execSync("npm install --omit=dev", {
      cwd: pluginRoot,
      stdio: ["pipe", "pipe", "inherit"],
      timeout: 12e4
    });
    console.error("[memory-lite] Dependencies installed.");
    return existsSync3(join2(pluginRoot, "node_modules", "better-sqlite3"));
  } catch (err) {
    console.error("[memory-lite] npm install failed:", err.message);
    return false;
  }
}
async function handleStart() {
  if (await waitForHealth(1e3)) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  const pidPath = join2(homedir2(), ".memory-lite", "worker.pid");
  try {
    if (existsSync3(pidPath)) {
      const ageMs = Date.now() - statSync(pidPath).mtimeMs;
      if (ageMs < 15e3) {
        console.error("[memory-lite] PID file is recent (<15s), waiting for existing spawn...");
        if (await waitForReadiness(15e3)) {
          console.log(JSON.stringify(formatSilentOutput()));
          return;
        }
        console.error("[memory-lite] Existing spawn seems to have failed, attempting new spawn");
      }
    }
  } catch {
  }
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join2(dirname(fileURLToPath(import.meta.url)), "..");
  const workerScript = join2(pluginRoot, "scripts", "worker.mjs");
  if (!ensureDeps(pluginRoot)) {
    console.error("[memory-lite] Cannot start worker: dependencies missing");
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  try {
    const child = spawn(process.execPath, [workerScript], {
      stdio: "ignore",
      detached: true,
      env: { ...process.env, MEMORY_LITE_PORT: String(getSetting("WORKER_PORT")) }
    });
    if (child.pid === void 0) {
      console.error("[memory-lite] Failed to spawn worker: no PID");
      console.log(JSON.stringify(formatSilentOutput()));
      return;
    }
    child.unref();
  } catch (err) {
    console.error("[memory-lite] Failed to spawn worker:", err.message);
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  const healthy = await waitForReadiness(1e4);
  if (!healthy) {
    console.error("[memory-lite] Worker spawned but health check timed out");
  }
  console.log(JSON.stringify(formatSilentOutput()));
}
async function handleContext(input) {
  const project = getProjectName(input.cwd);
  const res = await workerFetch(`/api/context?project=${encodeURIComponent(project)}`);
  if (!res || !res.ok) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  const data = await res.json();
  if (!data.context) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  console.log(JSON.stringify(formatContextOutput(data.context)));
}
async function handleSessionInit(input) {
  if (!input.sessionId) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  const project = getProjectName(input.cwd);
  const prompt = input.prompt ? stripPrivateTags(input.prompt) : void 0;
  await workerFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ contentSessionId: input.sessionId, project, prompt })
  });
  console.log(JSON.stringify(formatSilentOutput()));
}
var IGNORED_TOOLS = /* @__PURE__ */ new Set([
  "ToolSearch",
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskStop",
  "TaskOutput",
  "EnterPlanMode",
  "ExitPlanMode",
  "AskUserQuestion",
  "Skill",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool"
]);
async function handleObservation(input) {
  if (!input.sessionId || !input.toolName) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  if (IGNORED_TOOLS.has(input.toolName)) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  const cleanInput = input.toolInput ? stripPrivateTags(input.toolInput) : "";
  const cleanResponse = input.toolResponse ? stripPrivateTags(input.toolResponse) : "";
  await workerFetch("/api/observations", {
    method: "POST",
    body: JSON.stringify({
      contentSessionId: input.sessionId,
      tool_name: input.toolName,
      tool_input: cleanInput,
      tool_response: cleanResponse,
      cwd: input.cwd
    })
  });
  console.log(JSON.stringify(formatSilentOutput()));
}
async function handleSummarize(input) {
  if (!input.sessionId) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  let lastAssistantMessage = "";
  if (input.transcriptPath) {
    try {
      const content = readFileSync2(input.transcriptPath, "utf-8");
      const lines = content.trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === "assistant" || entry.role === "assistant") {
            const msg = entry.message?.content || entry.content;
            if (typeof msg === "string") {
              lastAssistantMessage = msg;
            } else if (Array.isArray(msg)) {
              lastAssistantMessage = msg.filter((c) => c.type === "text").map((c) => c.text).join("\n");
            }
            break;
          }
        } catch {
        }
      }
    } catch {
    }
  }
  await workerFetch("/api/summarize", {
    method: "POST",
    body: JSON.stringify({
      contentSessionId: input.sessionId,
      last_assistant_message: lastAssistantMessage
    })
  });
  console.log(JSON.stringify(formatSilentOutput()));
}
async function handleSessionEnd(input) {
  if (!input.sessionId) {
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }
  await workerFetch("/api/sessions/complete", {
    method: "POST",
    body: JSON.stringify({ contentSessionId: input.sessionId })
  });
  console.log(JSON.stringify(formatSilentOutput()));
}
async function main() {
  const event = process.argv[2];
  const raw = await readJsonFromStdin();
  const input = normalizeInput(raw);
  switch (event) {
    case "start":
      await handleStart();
      break;
    case "context":
      await handleContext(input);
      break;
    case "session-init":
      await handleSessionInit(input);
      break;
    case "observation":
      await handleObservation(input);
      break;
    case "summarize":
      await handleSummarize(input);
      break;
    case "session-end":
      await handleSessionEnd(input);
      break;
    default:
      console.error(`[hook] Unknown event: ${event}`);
      console.log(JSON.stringify(formatSilentOutput()));
  }
}
main().then(() => process.exit(0)).catch((err) => {
  console.error("[hook] Fatal error:", err);
  process.exit(0);
});
