/**
 * Worker HTTP server entry point.
 * Delegates lifecycle management to lifecycle.ts.
 */

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { app } from './routes.js';
import { getSetting } from '../utils/settings.js';
import { getDb } from '../db/database.js';
import {
  checkExistingWorker, writePid,
  startReaper, installIdleMiddleware, startIdleShutdown,
  installSignalHandlers, recoverPendingMessages,
} from './lifecycle.js';
import { logger } from '../utils/logger.js';

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

// Check if another worker is running
const alreadyRunning = await checkExistingWorker(port);
if (alreadyRunning) process.exit(0);

// Initialize
writePid(port);
getDb(); // Eagerly initialize DB so /api/readiness becomes true before first request
installSignalHandlers();
installIdleMiddleware(app);
startReaper();
startIdleShutdown();
recoverPendingMessages();

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  logger.info('worker', `Memory-lite worker running on http://127.0.0.1:${port}`);
});
