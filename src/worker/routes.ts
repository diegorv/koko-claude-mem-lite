/**
 * Route barrel — mounts all domain-specific route modules under /api.
 */

import { Hono } from 'hono';
import { sessionRoutes } from './routes/sessions.js';
import { searchRoutes } from './routes/search.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { cleanupRoutes } from './routes/cleanup.js';
import { settingsRoutes } from './routes/settings.js';

export const app = new Hono();

app.route('/api', sessionRoutes);
app.route('/api', searchRoutes);
app.route('/api', dashboardRoutes);
app.route('/api', cleanupRoutes);
app.route('/api', settingsRoutes);
