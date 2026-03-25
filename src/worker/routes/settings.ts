import { Hono } from 'hono';
import { getAllSettings, updateSettings } from '../../utils/settings.js';
import { getActiveSessionIds, getSessionAge } from '../observer.js';
import { deleteObservation, deleteSummary, deleteSession } from '../../db/queries.js';
import { generateContext } from '../../context/generator.js';
import { isDbReady } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import { safeParseInt } from './utils.js';

export const settingsRoutes = new Hono();

// Health check (liveness — responds if server is up)
settingsRoutes.get('/health', (c) => c.json({ ok: true }));

// Readiness check (DB fully initialized)
settingsRoutes.get('/readiness', (c) => {
  if (!isDbReady()) {
    return c.json({ ok: false, reason: 'DB not initialized' }, 503);
  }
  return c.json({ ok: true });
});

// Context injection for SessionStart
settingsRoutes.get('/context', (c) => {
  try {
    const project = c.req.query('project') || 'unknown';
    const context = generateContext(project);
    return c.json({ context });
  } catch (error) {
    logger.error('routes', '/api/context error', error);
    return c.json({ error: 'Failed to generate context' }, 500);
  }
});

// Settings
settingsRoutes.get('/settings', (c) => {
  try {
    return c.json(getAllSettings());
  } catch (error) {
    logger.error('routes', 'GET /api/settings error', error);
    return c.json({ error: 'Failed to get settings' }, 500);
  }
});

settingsRoutes.put('/settings', async (c) => {
  try {
    const body = await c.req.json();
    const updated = updateSettings(body);
    return c.json(updated);
  } catch (error) {
    logger.error('routes', 'PUT /api/settings error', error);
    return c.json({ error: 'Failed to update settings' }, 500);
  }
});

// Debug
settingsRoutes.get('/debug/sessions', (c) => {
  const sessions = getActiveSessionIds().map(id => ({
    contentSessionId: id,
    idleMs: Math.round(getSessionAge(id)),
  }));
  return c.json({
    activeSessions: sessions,
    uptime: Math.floor(process.uptime()),
    pid: process.pid,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

// Delete routes
settingsRoutes.delete('/observations/:id', (c) => {
  try {
    const id = safeParseInt(c.req.param('id'), NaN);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    const deleted = deleteObservation(id);
    if (!deleted) return c.json({ error: 'Observation not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    logger.error('routes', 'DELETE /api/observations error', error);
    return c.json({ error: 'Failed to delete observation' }, 500);
  }
});

settingsRoutes.delete('/summaries/:id', (c) => {
  try {
    const id = safeParseInt(c.req.param('id'), NaN);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    const deleted = deleteSummary(id);
    if (!deleted) return c.json({ error: 'Summary not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    logger.error('routes', 'DELETE /api/summaries error', error);
    return c.json({ error: 'Failed to delete summary' }, 500);
  }
});

settingsRoutes.delete('/sessions/:id', (c) => {
  try {
    const id = safeParseInt(c.req.param('id'), NaN);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    const deleted = deleteSession(id);
    if (!deleted) return c.json({ error: 'Session not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    logger.error('routes', 'DELETE /api/sessions error', error);
    return c.json({ error: 'Failed to delete session' }, 500);
  }
});
