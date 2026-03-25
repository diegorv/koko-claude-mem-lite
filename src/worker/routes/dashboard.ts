import { Hono } from 'hono';
import { getDb } from '../../db/database.js';
import { generateContextDetailed } from '../../context/generator.js';
import { getActiveSessionIds, getObserverDetails } from '../observer.js';
import { logger } from '../../utils/logger.js';
import { clamp, safeParseInt, MAX_LIMIT } from './utils.js';

export const dashboardRoutes = new Hono();

dashboardRoutes.get('/dashboard/sessions', (c) => {
  try {
    const project = c.req.query('project');
    const limit = clamp(safeParseInt(c.req.query('limit'), 50), 1, MAX_LIMIT);
    const offset = Math.max(0, safeParseInt(c.req.query('offset'), 0));
    const db = getDb();

    const whereClause = project ? 'WHERE s.project = ?' : '';
    const params = project ? [project, limit, offset] : [limit, offset];

    const sessions = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM observations o WHERE o.session_id = s.id) as observation_count,
        CASE WHEN sm.id IS NOT NULL THEN json_object(
          'request', sm.request,
          'investigated', sm.investigated,
          'learned', sm.learned,
          'completed', sm.completed,
          'next_steps', sm.next_steps
        ) ELSE NULL END as summary
      FROM sessions s
      LEFT JOIN summaries sm ON sm.session_id = s.id
      ${whereClause}
      ORDER BY s.created_at_epoch DESC
      LIMIT ? OFFSET ?
    `).all(...params);

    const total = db.prepare(`SELECT COUNT(*) as count FROM sessions ${project ? 'WHERE project = ?' : ''}`).get(...(project ? [project] : [])) as { count: number };

    return c.json({ sessions, total: total.count });
  } catch (error) {
    logger.error('routes', '/api/dashboard/sessions error', error);
    return c.json({ error: 'Failed to list sessions' }, 500);
  }
});

dashboardRoutes.get('/dashboard/sessions/:sessionId/observations', (c) => {
  try {
    const sessionId = safeParseInt(c.req.param('sessionId'), NaN);
    const db = getDb();
    const observations = db.prepare(
      'SELECT * FROM observations WHERE session_id = ? ORDER BY created_at_epoch ASC'
    ).all(sessionId);
    return c.json({ observations });
  } catch (error) {
    logger.error('routes', '/api/dashboard/observations error', error);
    return c.json({ error: 'Failed to list observations' }, 500);
  }
});

dashboardRoutes.get('/dashboard/projects', (c) => {
  try {
    const db = getDb();
    const projects = db.prepare(`
      SELECT project, COUNT(*) as session_count,
        MAX(created_at) as last_active
      FROM sessions
      GROUP BY project
      ORDER BY last_active DESC
    `).all();
    return c.json({ projects });
  } catch (error) {
    logger.error('routes', '/api/dashboard/projects error', error);
    return c.json({ error: 'Failed to list projects' }, 500);
  }
});

dashboardRoutes.get('/dashboard/stats', (c) => {
  try {
    const db = getDb();
    const sessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const activeSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get() as { count: number };
    const observations = db.prepare('SELECT COUNT(*) as count FROM observations').get() as { count: number };
    const summaries = db.prepare('SELECT COUNT(*) as count FROM summaries').get() as { count: number };
    const projects = db.prepare('SELECT COUNT(DISTINCT project) as count FROM sessions').get() as { count: number };

    const types = db.prepare(
      "SELECT type, COUNT(*) as count FROM observations GROUP BY type ORDER BY count DESC"
    ).all() as { type: string; count: number }[];

    const daily = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM observations
      WHERE created_at_epoch > ?
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all(Date.now() - 7 * 86400000) as { day: string; count: number }[];

    const pendingMessages = db.prepare('SELECT COUNT(*) as count FROM pending_messages').get() as { count: number };
    const activeObserverIds = getActiveSessionIds();

    return c.json({
      sessions: sessions.count,
      activeSessions: activeSessions.count,
      observations: observations.count,
      summaries: summaries.count,
      projects: projects.count,
      pendingMessages: pendingMessages.count,
      activeObservers: activeObserverIds.length,
      types,
      daily,
      uptime: Math.floor(process.uptime()),
    });
  } catch (error) {
    logger.error('routes', '/api/dashboard/stats error', error);
    return c.json({ error: 'Failed to get stats' }, 500);
  }
});

dashboardRoutes.get('/dashboard/feed', (c) => {
  try {
    const project = c.req.query('project');
    const limit = clamp(safeParseInt(c.req.query('limit'), 30), 1, MAX_LIMIT);
    const before = c.req.query('before');
    const db = getDb();

    const obsConditions: string[] = [];
    const sumConditions: string[] = [];
    const params: any[] = [];

    if (project) {
      obsConditions.push('o.project = ?');
      sumConditions.push('sm.project = ?');
      params.push(project);
    }
    if (before) {
      obsConditions.push('o.created_at_epoch < ?');
      sumConditions.push('sm.created_at_epoch < ?');
      params.push(safeParseInt(before, 0));
    }

    const obsWhere = obsConditions.length > 0 ? 'WHERE ' + obsConditions.join(' AND ') : '';
    const sumWhere = sumConditions.length > 0 ? 'WHERE ' + sumConditions.join(' AND ') : '';

    const obs = db.prepare(`
      SELECT o.id, o.session_id, o.project, o.type, o.title, o.facts, o.narrative,
        o.files_read, o.files_modified, o.created_at, o.created_at_epoch,
        s.content_session_id,
        'observation' as item_type
      FROM observations o
      JOIN sessions s ON s.id = o.session_id
      ${obsWhere}
      ORDER BY o.created_at_epoch DESC LIMIT ?
    `).all(...params, limit);

    const sums = db.prepare(`
      SELECT sm.id, sm.session_id, sm.project, sm.request, sm.investigated, sm.learned,
        sm.completed, sm.next_steps, sm.created_at, sm.created_at_epoch,
        s.content_session_id,
        'summary' as item_type
      FROM summaries sm
      JOIN sessions s ON s.id = sm.session_id
      ${sumWhere}
      ORDER BY sm.created_at_epoch DESC LIMIT ?
    `).all(...params, limit);

    const feed = [...obs, ...sums]
      .sort((a: any, b: any) => b.created_at_epoch - a.created_at_epoch)
      .slice(0, limit);

    return c.json({ feed });
  } catch (error) {
    logger.error('routes', '/api/dashboard/feed error', error);
    return c.json({ error: 'Failed to get feed' }, 500);
  }
});

dashboardRoutes.get('/dashboard/live', (c) => {
  try {
    const db = getDb();
    const observers = getObserverDetails().map(o => ({
      ...o,
      pendingCount: db.prepare(
        'SELECT COUNT(*) as count FROM pending_messages WHERE content_session_id = ?'
      ).get(o.contentSessionId) as { count: number } | undefined,
    })).map(o => ({ ...o, pendingCount: (o.pendingCount as any)?.count ?? 0 }));

    const queue = db.prepare(`
      SELECT pm.id, pm.content_session_id, pm.kind, pm.status, pm.created_at_epoch,
        s.project
      FROM pending_messages pm
      LEFT JOIN sessions s ON s.content_session_id = pm.content_session_id
      ORDER BY pm.id ASC
      LIMIT 200
    `).all() as { id: number; content_session_id: string; kind: string; status: string; created_at_epoch: number; project: string | null }[];

    return c.json({ observers, queue });
  } catch (error) {
    logger.error('routes', '/api/dashboard/live error', error);
    return c.json({ error: 'Failed to get live data' }, 500);
  }
});

dashboardRoutes.get('/dashboard/context-preview', (c) => {
  try {
    const project = c.req.query('project') || 'unknown';
    const breakdown = generateContextDetailed(project);
    return c.json(breakdown);
  } catch (error) {
    logger.error('routes', '/api/dashboard/context-preview error', error);
    return c.json({ error: 'Failed to generate context preview' }, 500);
  }
});
