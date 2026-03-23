import { Hono } from 'hono';
import {
  createSession, completeSession, getSessionByContentId,
  storeObservation, storeSummary,
  getRecentObservations, getRecentSummaries,
  searchObservationsFts, searchObservationsIndex,
  getObservationsByIds, getTimelineAroundObservation,
  type ObservationInput,
} from '../db/queries.js';
import { formatSearchIndex, formatTimeline, formatObservationsFull } from './formatter.js';
import { generateContext } from '../context/generator.js';
import { extractObservation, generateSummary } from './summarizer.js';
import { stripPrivateTags, isEntirelyPrivate } from '../utils/privacy.js';
import { getSetting } from '../utils/settings.js';
import { embedObservation, searchSemantic } from '../embeddings/embeddings.js';
import { getDb } from '../db/database.js';

export const app = new Hono();

// Health check
app.get('/api/health', (c) => c.json({ ok: true }));

// Context injection for SessionStart
app.get('/api/context', (c) => {
  try {
    const project = c.req.query('project') || 'unknown';
    const context = generateContext(project);
    return c.json({ context });
  } catch (error) {
    console.error('[routes] /api/context error:', error);
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
    return c.json({ sessionId: session.id });
  } catch (error) {
    console.error('[routes] /api/sessions error:', error);
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

// Store observation (extracts structured data via AI)
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

    const parsed = await extractObservation(tool_name, cleanInput, cleanResponse, cwd);

    if (!parsed) {
      const fallback: ObservationInput = {
        type: 'raw',
        title: `${tool_name} usage`,
        facts: [],
        narrative: null,
        files_read: [],
        files_modified: [],
      };
      const result = storeObservation(session.id, session.project, fallback, contentSessionId);
      return c.json({ ok: true, observationId: result.id, raw: true });
    }

    const result = storeObservation(session.id, session.project, parsed, contentSessionId);

    if (!result.deduplicated) {
      embedObservation(getDb(), result.id, parsed.title, parsed.narrative, parsed.facts)
        .catch(err => console.error('[routes] embedding failed:', err));
    }

    return c.json({ ok: true, observationId: result.id, deduplicated: result.deduplicated });
  } catch (error) {
    console.error('[routes] /api/observations error:', error);
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

    if (!last_assistant_message) {
      return c.json({ ok: true, skipped: true, reason: 'no assistant message' });
    }

    const summary = await generateSummary(last_assistant_message);
    if (!summary) return c.json({ ok: true, skipped: true, reason: 'AI summary failed' });

    storeSummary(session.id, session.project, summary);
    return c.json({ ok: true });
  } catch (error) {
    console.error('[routes] /api/summarize error:', error);
    return c.json({ error: 'Failed to generate summary' }, 500);
  }
});

// Complete session
app.post('/api/sessions/complete', async (c) => {
  try {
    const { contentSessionId } = await c.req.json();
    if (!contentSessionId) return c.json({ error: 'contentSessionId required' }, 400);
    completeSession(contentSessionId);
    return c.json({ ok: true });
  } catch (error) {
    console.error('[routes] /api/sessions/complete error:', error);
    return c.json({ error: 'Failed to complete session' }, 500);
  }
});

// --- Dashboard API routes ---

app.get('/api/dashboard/sessions', (c) => {
  try {
    const project = c.req.query('project');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const db = getDb();

    const whereClause = project ? 'WHERE s.project = ?' : '';
    const params = project ? [project, limit, offset] : [limit, offset];

    const sessions = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM observations o WHERE o.session_id = s.id) as observation_count,
        json_object(
          'request', sm.request,
          'investigated', sm.investigated,
          'learned', sm.learned,
          'completed', sm.completed,
          'next_steps', sm.next_steps
        ) as summary
      FROM sessions s
      LEFT JOIN summaries sm ON sm.session_id = s.id
      ${whereClause}
      ORDER BY s.created_at_epoch DESC
      LIMIT ? OFFSET ?
    `).all(...params);

    const total = db.prepare(`SELECT COUNT(*) as count FROM sessions ${project ? 'WHERE project = ?' : ''}`).get(...(project ? [project] : [])) as { count: number };

    return c.json({ sessions, total: total.count });
  } catch (error) {
    console.error('[routes] /api/dashboard/sessions error:', error);
    return c.json({ error: 'Failed to list sessions' }, 500);
  }
});

app.get('/api/dashboard/sessions/:sessionId/observations', (c) => {
  try {
    const sessionId = parseInt(c.req.param('sessionId'));
    const db = getDb();
    const observations = db.prepare(
      'SELECT * FROM observations WHERE session_id = ? ORDER BY created_at_epoch ASC'
    ).all(sessionId);
    return c.json({ observations });
  } catch (error) {
    console.error('[routes] /api/dashboard/observations error:', error);
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
    console.error('[routes] /api/dashboard/projects error:', error);
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
    console.error('[routes] /api/dashboard/stats error:', error);
    return c.json({ error: 'Failed to get stats' }, 500);
  }
});

app.get('/api/dashboard/feed', (c) => {
  try {
    const project = c.req.query('project');
    const limit = parseInt(c.req.query('limit') || '30');
    const before = c.req.query('before');
    const db = getDb();

    const conditions: string[] = [];
    const params: any[] = [];

    if (project) { conditions.push('project = ?'); params.push(project); }
    if (before) { conditions.push('created_at_epoch < ?'); params.push(parseInt(before)); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const obs = db.prepare(`
      SELECT o.id, o.session_id, o.project, o.type, o.title, o.facts, o.narrative,
        o.files_read, o.files_modified, o.created_at, o.created_at_epoch,
        s.content_session_id,
        'observation' as item_type
      FROM observations o
      JOIN sessions s ON s.id = o.session_id
      ${where ? where.replace(/project/g, 'o.project').replace(/created_at_epoch/g, 'o.created_at_epoch') : ''}
      ORDER BY o.created_at_epoch DESC LIMIT ?
    `).all(...params, limit);

    const sums = db.prepare(`
      SELECT sm.id, sm.session_id, sm.project, sm.request, sm.investigated, sm.learned,
        sm.completed, sm.next_steps, sm.created_at, sm.created_at_epoch,
        s.content_session_id,
        'summary' as item_type
      FROM summaries sm
      JOIN sessions s ON s.id = sm.session_id
      ${where ? where.replace(/project/g, 'sm.project').replace(/created_at_epoch/g, 'sm.created_at_epoch') : ''}
      ORDER BY sm.created_at_epoch DESC LIMIT ?
    `).all(...params, limit);

    const feed = [...obs, ...sums]
      .sort((a: any, b: any) => b.created_at_epoch - a.created_at_epoch)
      .slice(0, limit);

    return c.json({ feed });
  } catch (error) {
    console.error('[routes] /api/dashboard/feed error:', error);
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
      limit: parseInt(c.req.query('limit') || '20'),
      offset: parseInt(c.req.query('offset') || '0'),
    });

    const formatted = formatSearchIndex(results);
    return c.json({ content: [{ type: 'text', text: formatted }] });
  } catch (error) {
    console.error('[routes] /api/search/index error:', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});

app.get('/api/timeline', (c) => {
  try {
    const anchorId = parseInt(c.req.query('anchor') || '');
    if (isNaN(anchorId)) return c.json({ error: 'anchor parameter required (observation ID)' }, 400);

    const depthBefore = parseInt(c.req.query('depth_before') || '5');
    const depthAfter = parseInt(c.req.query('depth_after') || '5');
    const project = c.req.query('project');

    const { anchor, before, after } = getTimelineAroundObservation(anchorId, depthBefore, depthAfter, project);
    if (!anchor) return c.json({ error: 'Observation not found' }, 404);

    const formatted = formatTimeline(before, anchor, after);
    return c.json({ content: [{ type: 'text', text: formatted }] });
  } catch (error) {
    console.error('[routes] /api/timeline error:', error);
    return c.json({ error: 'Timeline failed' }, 500);
  }
});

app.post('/api/observations/batch', async (c) => {
  try {
    const { ids } = await c.req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'ids array required' }, 400);
    }

    const observations = getObservationsByIds(ids.map(Number));
    const formatted = formatObservationsFull(observations);
    return c.json({ content: [{ type: 'text', text: formatted }] });
  } catch (error) {
    console.error('[routes] /api/observations/batch error:', error);
    return c.json({ error: 'Batch fetch failed' }, 500);
  }
});

app.get('/api/search', async (c) => {
  try {
    const q = c.req.query('q');
    const project = c.req.query('project');
    const mode = c.req.query('mode') || 'fts';
    const limit = parseInt(c.req.query('limit') || '10');

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
    console.error('[routes] /api/search error:', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});
