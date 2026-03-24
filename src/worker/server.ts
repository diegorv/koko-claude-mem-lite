import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { app } from './routes.js';
import { getSetting } from '../utils/settings.js';
import { getPidPath } from '../utils/paths.js';
import { closeDb } from '../db/database.js';
import { destroyAllObservers } from './observer.js';

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

const port = parseInt(getSetting('WORKER_PORT'));
const pidPath = getPidPath();

function writePid(): void {
  writeFileSync(pidPath, String(process.pid));
}

function removePid(): void {
  try {
    if (existsSync(pidPath)) unlinkSync(pidPath);
  } catch { /* ignore */ }
}

function shutdown(): void {
  console.log('[worker] Shutting down...');
  destroyAllObservers();
  removePid();
  closeDb();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Check if another worker is running
if (existsSync(pidPath)) {
  const oldPid = parseInt(readFileSync(pidPath, 'utf-8').trim());
  try {
    process.kill(oldPid, 0);
    console.log(`[worker] Another worker already running (PID ${oldPid}). Exiting.`);
    process.exit(0);
  } catch {
    removePid();
  }
}

writePid();

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`[worker] Memory-lite worker running on http://127.0.0.1:${port}`);
});
