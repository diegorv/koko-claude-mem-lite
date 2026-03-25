/**
 * Worker process spawning, health checking, and dependency management.
 * Used by the hook to ensure the worker daemon is running.
 */

import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { formatSilentOutput } from './adapter.js';
import { getSetting } from '../utils/settings.js';

const WORKER_BASE = `http://127.0.0.1:${getSetting('WORKER_PORT')}`;

export async function workerFetch(path: string, options?: RequestInit, retries = 2, timeoutMs = 10_000): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${WORKER_BASE}${path}`, {
        ...options,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...options?.headers },
      });
      clearTimeout(timeout);
      if (res.ok || res.status < 500) return res;
    } catch {
      // Network error or timeout — retry
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

export async function waitForHealth(timeoutMs: number): Promise<boolean> {
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

export async function waitForReadiness(timeoutMs: number): Promise<boolean> {
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

export function ensureDeps(pluginRoot: string): boolean {
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

export async function spawnWorker(): Promise<void> {
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
        let processAlive = false;
        try {
          const raw = readFileSync(pidPath, 'utf-8').trim();
          const info = JSON.parse(raw);
          process.kill(info.pid, 0);
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

  if (!ensureDeps(pluginRoot)) {
    console.error('[memory-lite] Cannot start worker: dependencies missing');
    console.log(JSON.stringify(formatSilentOutput()));
    return;
  }

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

  const healthy = await waitForReadiness(10_000);
  if (!healthy) {
    console.error('[memory-lite] Worker spawned but health check timed out');
  }

  console.log(JSON.stringify(formatSilentOutput()));
}
