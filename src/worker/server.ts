import express from 'express';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { router } from './routes.js';
import { getSetting } from '../utils/settings.js';
import { getPidPath } from '../utils/paths.js';
import { closeDb } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(router);

// Serve dashboard UI
const uiPath = join(__dirname, '..', 'ui');
if (existsSync(uiPath)) {
  app.use(express.static(uiPath));
  app.get('/', (_req, res) => {
    res.sendFile(join(uiPath, 'index.html'));
  });
}

const port = getSetting('WORKER_PORT');
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
    process.kill(oldPid, 0); // test if process exists
    console.log(`[worker] Another worker already running (PID ${oldPid}). Exiting.`);
    process.exit(0);
  } catch {
    // Process doesn't exist, stale PID file
    removePid();
  }
}

writePid();

app.listen(port, '127.0.0.1', () => {
  console.log(`[worker] Memory-lite worker running on http://127.0.0.1:${port}`);
});
