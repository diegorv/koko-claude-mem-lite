import { Hono } from 'hono';
import {
  createSession, completeSession, getSessionByContentId,
  storeObservation, storeSummary,
  getRecentObservations, getRecentSummaries,
  searchObservationsFts, searchObservationsIndex,
  getObservationsByIds, getTimelineAroundObservation,
  deleteObservation, deleteSummary, deleteSession,
} from '../db/queries.js';
import { formatSearchIndex, formatTimeline, formatObservationsFull } from './formatter.js';
import { generateContext, generateContextDetailed } from '../context/generator.js';
import { extractObservation, generateSummary, reviewForCleanup, type CleanupItem } from './summarizer.js';
import { getOrCreateObserver, getObserver, destroyObserver, getActiveSessionIds, getSessionAge } from './observer.js';
import { stripPrivateTags, isEntirelyPrivate } from '../utils/privacy.js';
import { getAllSettings, updateSettings } from '../utils/settings.js';
import { embedObservation, searchSemantic } from '../embeddings/embeddings.js';
import { getDb, isDbReady } from '../db/database.js';
import { logger } from '../utils/logger.js';

export const app = new Hono();

const MAX_LIMIT = 500;
const MAX_DEPTH = 50;
const MAX_BATCH = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeParseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

// Health check (liveness — responds if server is up)
app.get('/api/health', (c) => c.json({ ok: true }));

// Readiness check (DB fully initialized)
app.get('/api/readiness', (c) => {
  if (!isDbReady()) {
    return c.json({ ok: false, reason: 'DB not initialized' }, 503);
  }
  return c.json({ ok: true });
});

// Context injection for SessionStart
app.get('/api/context', (c) => {
  try {
    const project = c.req.query('project') || 'unknown';
    const context = generateContext(project);
    return c.json({ context });
  } catch (error) {
    logger.error('routes', '/api/context error', error);
    return c.json({ error: 'Failed to generate context' }, 500);
  }
});

// Create/find session
app.post('/api/sessions', async (c) => {
  try {
    const { contentSessionId, project, prompt } = await c.req.json();
    if (!contentSessionId) return c.json({ error: 'contentSessionId required' }, 400);

    const cleanPrompt = prompt ? stripPrivateTags(prompt) : undefined;
    if (prompt && isEntirelyPrivate(prompt)) {
      return c.json({ sessionId: null, skipped: true });
    }

    const session = createSession(contentSessionId, project || 'unknown', cleanPrompt);

    // Start multi-turn observer conversation
    getOrCreateObserver(contentSessionId, project || 'unknown', cleanPrompt);

    return c.json({ sessionId: session.id });
  } catch (error) {
    logger.error('routes', '/api/sessions error', error);
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

// Store observation (multi-turn observer — fire-and-forget to avoid blocking hooks)
app.post('/api/observations', async (c) => {
  try {
    const { contentSessionId, tool_name, tool_input, tool_response, cwd } = await c.req.json();
    if (!contentSessionId || !tool_name) {
      return c.json({ error: 'contentSessionId and tool_name required' }, 400);
    }

    const session = getSessionByContentId(contentSessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const cleanInput = stripPrivateTags(tool_input || '');
    const cleanResponse = stripPrivateTags(tool_response || '');

    // Enqueue observation and return immediately — don't block the hook process
    const observer = getObserver(contentSessionId);
    if (observer) {
      // Fire-and-forget: pushObservation enqueues to DurableQueue, SDK processes async
      observer.pushObservation(tool_name, cleanInput, cleanResponse, cwd).catch(err => {
        logger.error('routes', 'Observer pushObservation error', err);
      });
      return c.json({ ok: true, queued: true });
    }

    // No observer session — use single-turn fallback (still awaited for result)
    const parsed = await extractObservation(tool_name, cleanInput, cleanResponse, cwd);

    if (!parsed || parsed.type === 'skip') {
      return c.json({ ok: true, skipped: true });
    }

    const result = storeObservation(session.id, session.project, parsed, contentSessionId);

    if (!result.deduplicated) {
      embedObservation(getDb(), result.id, parsed.title, parsed.narrative, parsed.facts)
        .catch(err => logger.error('routes', 'embedding failed', err));
    }

    return c.json({ ok: true, observationId: result.id, deduplicated: result.deduplicated });
  } catch (error) {
    logger.error('routes', '/api/observations error', error);
    return c.json({ error: 'Failed to store observation' }, 500);
  }
});

// Generate session summary
app.post('/api/summarize', async (c) => {
  try {
    const { contentSessionId, last_assistant_message } = await c.req.json();
    if (!contentSessionId) return c.json({ error: 'contentSessionId required' }, 400);

    const session = getSessionByContentId(contentSessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    if (!last_assistant_message || last_assistant_message.trim().length < 100) {
      return c.json({ ok: true, skipped: true, reason: 'no meaningful assistant message' });
    }

    // Fire-and-forget for observer path (storage handled internally)
    const observer = getObserver(contentSessionId);
    if (observer) {
      observer.pushSummary(last_assistant_message).catch(err => {
        logger.error('routes', 'Observer pushSummary error', err);
      });
      return c.json({ ok: true, queued: true });
    }

    // No observer — single-turn fallback
    const summary = await generateSummary(last_assistant_message);
    if (!summary) return c.json({ ok: true, skipped: true, reason: 'AI summary failed' });

    // Skip summaries that are clearly empty/trivial
    const hasContent = summary.completed || summary.learned || summary.investigated;
    const isTrivial = hasContent && /nothing|no .*(finding|change|work|action|interaction)/i.test(
      [summary.completed, summary.learned, summary.investigated].filter(Boolean).join(' ')
    );
    if (!hasContent || isTrivial) {
      return c.json({ ok: true, skipped: true, reason: 'trivial summary' });
    }

    storeSummary(session.id, session.project, summary);
    return c.json({ ok: true });
  } catch (error) {
    logger.error('routes', '/api/summarize error', error);
    return c.json({ error: 'Failed to generate summary' }, 500);
  }
});

// Complete session
app.post('/api/sessions/complete', async (c) => {
  try {
    const { contentSessionId } = await c.req.json();
    if (!contentSessionId) return c.json({ error: 'contentSessionId required' }, 400);
    completeSession(contentSessionId);
    destroyObserver(contentSessionId);
    return c.json({ ok: true });
  } catch (error) {
    logger.error('routes', '/api/sessions/complete error', error);
    return c.json({ error: 'Failed to complete session' }, 500);
  }
});

// --- Dashboard API routes ---

app.get('/api/dashboard/sessions', (c) => {
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

app.get('/api/dashboard/sessions/:sessionId/observations', (c) => {
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

app.get('/api/dashboard/projects', (c) => {
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

app.get('/api/dashboard/stats', (c) => {
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

    return c.json({
      sessions: sessions.count,
      activeSessions: activeSessions.count,
      observations: observations.count,
      summaries: summaries.count,
      projects: projects.count,
      types,
      daily,
      uptime: Math.floor(process.uptime()),
    });
  } catch (error) {
    logger.error('routes', '/api/dashboard/stats error', error);
    return c.json({ error: 'Failed to get stats' }, 500);
  }
});

app.get('/api/dashboard/feed', (c) => {
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

// --- Progressive Disclosure API ---

app.get('/api/search/index', (c) => {
  try {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'q parameter required' }, 400);

    const results = searchObservationsIndex({
      query: q,
      project: c.req.query('project'),
      type: c.req.query('type'),
      dateStart: c.req.query('dateStart'),
      dateEnd: c.req.query('dateEnd'),
      limit: clamp(safeParseInt(c.req.query('limit'), 20), 1, MAX_LIMIT),
      offset: Math.max(0, safeParseInt(c.req.query('offset'), 0)),
    });

    const formatted = formatSearchIndex(results);
    return c.json({ content: [{ type: 'text', text: formatted }] });
  } catch (error) {
    logger.error('routes', '/api/search/index error', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});

app.get('/api/timeline', (c) => {
  try {
    const anchorId = safeParseInt(c.req.query('anchor'), NaN);
    if (isNaN(anchorId)) return c.json({ error: 'anchor parameter required (observation ID)' }, 400);

    const depthBefore = clamp(safeParseInt(c.req.query('depth_before'), 5), 1, MAX_DEPTH);
    const depthAfter = clamp(safeParseInt(c.req.query('depth_after'), 5), 1, MAX_DEPTH);
    const project = c.req.query('project');

    const { anchor, before, after } = getTimelineAroundObservation(anchorId, depthBefore, depthAfter, project);
    if (!anchor) return c.json({ error: 'Observation not found' }, 404);

    const formatted = formatTimeline(before, anchor, after);
    return c.json({ content: [{ type: 'text', text: formatted }] });
  } catch (error) {
    logger.error('routes', '/api/timeline error', error);
    return c.json({ error: 'Timeline failed' }, 500);
  }
});

app.post('/api/observations/batch', async (c) => {
  try {
    const { ids } = await c.req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'ids array required' }, 400);
    }
    if (ids.length > MAX_BATCH) {
      return c.json({ error: `Too many IDs (max ${MAX_BATCH})` }, 400);
    }

    const observations = getObservationsByIds(ids.map(Number));
    const formatted = formatObservationsFull(observations);
    return c.json({ content: [{ type: 'text', text: formatted }] });
  } catch (error) {
    logger.error('routes', '/api/observations/batch error', error);
    return c.json({ error: 'Batch fetch failed' }, 500);
  }
});

app.get('/api/search', async (c) => {
  try {
    const q = c.req.query('q');
    const project = c.req.query('project');
    const mode = c.req.query('mode') || 'fts';
    const limit = clamp(safeParseInt(c.req.query('limit'), 10), 1, MAX_LIMIT);

    if (!q) return c.json({ error: 'q parameter required' }, 400);

    if (mode === 'semantic') {
      const vecResults = await searchSemantic(getDb(), q, limit);
      if (vecResults.length === 0) {
        return c.json({ results: [], mode: 'semantic', message: 'No results (Ollama may be unavailable)' });
      }
      const db = getDb();
      const enriched = vecResults.map(r => {
        const obs = db.prepare('SELECT * FROM observations WHERE id = ?').get(r.observationId) as any;
        return obs ? { ...obs, distance: r.distance } : null;
      }).filter(Boolean);
      return c.json({ results: enriched, mode: 'semantic' });
    }

    const results = searchObservationsFts(q, project, limit);
    return c.json({ results, mode: 'fts' });
  } catch (error) {
    logger.error('routes', '/api/search error', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});

// --- Delete routes ---

app.delete('/api/observations/:id', (c) => {
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

app.delete('/api/summaries/:id', (c) => {
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

app.delete('/api/sessions/:id', (c) => {
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

// --- Context preview ---

app.get('/api/dashboard/context-preview', (c) => {
  try {
    const project = c.req.query('project') || 'unknown';
    const breakdown = generateContextDetailed(project);
    return c.json(breakdown);
  } catch (error) {
    logger.error('routes', '/api/dashboard/context-preview error', error);
    return c.json({ error: 'Failed to generate context preview' }, 500);
  }
});

// --- Settings ---

app.get('/api/settings', (c) => {
  try {
    return c.json(getAllSettings());
  } catch (error) {
    logger.error('routes', 'GET /api/settings error', error);
    return c.json({ error: 'Failed to get settings' }, 500);
  }
});

app.put('/api/settings', async (c) => {
  try {
    const body = await c.req.json();
    const updated = updateSettings(body);
    return c.json(updated);
  } catch (error) {
    logger.error('routes', 'PUT /api/settings error', error);
    return c.json({ error: 'Failed to update settings' }, 500);
  }
});

// --- Debug ---

app.get('/api/debug/sessions', (c) => {
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

// --- AI Cleanup ---

app.post('/api/cleanup/review', async (c) => {
  try {
    const { project } = await c.req.json();
    const proj = project || 'unknown';

    const summaries = getRecentSummaries(proj, 20);
    const observations = getRecentObservations(proj, 100);

    const items: CleanupItem[] = [];

    for (const s of summaries) {
      const parts = [s.request, s.completed, s.learned, s.next_steps].filter(Boolean);
      items.push({ id: s.id, type: 'summary', text: parts.join(' | ') });
    }

    for (const o of observations) {
      const parts = [o.title, o.narrative].filter(Boolean);
      items.push({ id: o.id, type: 'observation', text: `[${o.type}] ${parts.join(' - ')}` });
    }

    // SSE: send items immediately as pending, then AI results when ready
    return new Response(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (event: string, data: any) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };

          // Immediately send items so UI shows them as "pending"
          send('items', { items: items.map(i => ({ id: i.id, type: i.type, text: i.text })) });

          try {
            const results = await reviewForCleanup(items);
            // Send each result individually with tiny delay for animation
            for (const r of results) {
              send('result', r);
              await new Promise(resolve => setTimeout(resolve, 30));
            }
            send('done', { results, totalReviewed: items.length });
          } catch (err) {
            logger.error('cleanup', 'Review failed', err);
            send('done', { results: [], error: String(err) });
          }

          controller.close();
        }
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }
    );
  } catch (error) {
    logger.error('routes', '/api/cleanup/review error', error);
    return c.json({ error: 'Cleanup review failed' }, 500);
  }
});

app.post('/api/cleanup/apply', async (c) => {
  try {
    const { deletions } = await c.req.json() as { deletions: { id: number; type: 'observation' | 'summary' }[] };
    if (!Array.isArray(deletions)) return c.json({ error: 'deletions array required' }, 400);

    let deleted = 0;
    for (const d of deletions) {
      if (d.type === 'observation') {
        if (deleteObservation(d.id)) deleted++;
      } else if (d.type === 'summary') {
        if (deleteSummary(d.id)) deleted++;
      }
    }

    return c.json({ ok: true, deleted });
  } catch (error) {
    logger.error('routes', '/api/cleanup/apply error', error);
    return c.json({ error: 'Cleanup apply failed' }, 500);
  }
});
