import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { app } from './routes.js';
import { getSetting } from '../utils/settings.js';
import { getPidPath } from '../utils/paths.js';
import { closeDb, getDb } from '../db/database.js';
import { destroyAllObservers, destroyObserver, getActiveSessionIds, getSessionAge } from './observer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Serve dashboard UI
const uiPath = join(__dirname, '..', 'ui');
if (existsSync(uiPath)) {
  app.get('/', (c) => {
    const html = readFileSync(join(uiPath, 'index.html'), 'utf-8');
    return c.html(html);
  });
  app.use('/*', serveStatic({ root: uiPath }));
}

const port = getSetting('WORKER_PORT');
const pidPath = getPidPath();

interface PidInfo { pid: number; port: number; startedAt: number }

function writePid(): void {
  const info: PidInfo = { pid: process.pid, port, startedAt: Date.now() };
  writeFileSync(pidPath, JSON.stringify(info));
}

function removePid(): void {
  try {
    if (existsSync(pidPath)) unlinkSync(pidPath);
  } catch { /* ignore */ }
}

let shutdownInitiated = false;

// --- Stale session reaper (safety net for when session-end hook doesn't fire) ---
const STALE_SESSION_MS = 30 * 60 * 1000; // 30 min
const reaperInterval = setInterval(() => {
  try {
    for (const id of getActiveSessionIds()) {
      const age = getSessionAge(id);
      if (age > STALE_SESSION_MS) {
        console.log(`[reaper] Destroying stale session ${id} (idle: ${Math.round(age / 1000)}s)`);
        destroyObserver(id);
      }
    }
  } catch (err) {
    console.error('[reaper] Error:', err);
  }
}, 60_000);
reaperInterval.unref();

// --- Idle auto-shutdown (no sessions + no API activity for 30 min → exit) ---
const IDLE_SHUTDOWN_MS = 30 * 60 * 1000;
let lastApiActivity = Date.now();
app.use('/api/*', async (c, next) => {
  lastApiActivity = Date.now();
  await next();
});
const idleShutdownInterval = setInterval(() => {
  if (getActiveSessionIds().length === 0 && Date.now() - lastApiActivity > IDLE_SHUTDOWN_MS) {
    console.log('[worker] No active sessions and idle for 30min, shutting down');
    shutdown();
  }
}, 60_000);
idleShutdownInterval.unref();

function shutdown(): void {
  if (shutdownInitiated) return;
  shutdownInitiated = true;

  clearInterval(reaperInterval);
  clearInterval(idleShutdownInterval);

  const forceTimer = setTimeout(() => {
    console.error('[worker] Graceful shutdown timed out after 10s, force exiting');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  console.log('[worker] Shutting down...');
  destroyAllObservers();
  removePid();
  closeDb();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

// Check if another worker is running
async function checkExistingWorker(): Promise<boolean> {
  if (!existsSync(pidPath)) return false;
  try {
    const raw = readFileSync(pidPath, 'utf-8').trim();
    let oldPid: number;
    let oldPort: number = port;
    try {
      const info: PidInfo = JSON.parse(raw);
      oldPid = info.pid;
      oldPort = info.port;
    } catch {
      // Legacy format: plain PID number
      oldPid = parseInt(raw);
    }
    process.kill(oldPid, 0); // Check if process exists
    // Verify it's actually our worker via health check
    const res = await fetch(`http://127.0.0.1:${oldPort}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log(`[worker] Another worker already running (PID ${oldPid}). Exiting.`);
      return true;
    }
  } catch {
    // Process doesn't exist or health check failed — stale PID
  }
  removePid();
  return false;
}

const alreadyRunning = await checkExistingWorker();
if (alreadyRunning) process.exit(0);

writePid();
getDb(); // Eagerly initialize DB so /api/readiness becomes true before first request

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`[worker] Memory-lite worker running on http://127.0.0.1:${port}`);
});
