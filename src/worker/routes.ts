import { Router } from 'express';
import {
  createSession, completeSession, getSessionByContentId,
  storeObservation, storeSummary,
  getRecentObservations, getRecentSummaries,
  searchObservationsFts,
  type ObservationInput,
} from '../db/queries.js';
import { generateContext } from '../context/generator.js';
import { extractObservation, generateSummary } from './summarizer.js';
import { stripPrivateTags, isEntirelyPrivate } from '../utils/privacy.js';
import { getProjectName } from '../utils/paths.js';
import { getSetting } from '../utils/settings.js';
import { embedObservation, searchSemantic } from '../embeddings/embeddings.js';
import { getDb } from '../db/database.js';

export const router = Router();

// Health check
router.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Context injection for SessionStart
router.get('/api/context', (req, res) => {
  try {
    const project = (req.query.project as string) || 'unknown';
    const context = generateContext(project);
    res.json({ context });
  } catch (error) {
    console.error('[routes] /api/context error:', error);
    res.status(500).json({ error: 'Failed to generate context' });
  }
});

// Create/find session
router.post('/api/sessions', (req, res) => {
  try {
    const { contentSessionId, project, prompt } = req.body;
    if (!contentSessionId) {
      return res.status(400).json({ error: 'contentSessionId required' });
    }

    const cleanPrompt = prompt ? stripPrivateTags(prompt) : undefined;
    if (prompt && isEntirelyPrivate(prompt)) {
      return res.json({ sessionId: null, skipped: true });
    }

    const session = createSession(contentSessionId, project || 'unknown', cleanPrompt);
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('[routes] /api/sessions error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Store observation (extracts structured data via AI)
router.post('/api/observations', async (req, res) => {
  try {
    const { contentSessionId, tool_name, tool_input, tool_response, cwd } = req.body;
    if (!contentSessionId || !tool_name) {
      return res.status(400).json({ error: 'contentSessionId and tool_name required' });
    }

    const session = getSessionByContentId(contentSessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const cleanInput = stripPrivateTags(tool_input || '');
    const cleanResponse = stripPrivateTags(tool_response || '');

    // Extract structured observation via AI
    const parsed = await extractObservation(tool_name, cleanInput, cleanResponse, cwd);

    if (!parsed) {
      // AI extraction failed — store raw fallback
      const fallback: ObservationInput = {
        type: 'raw',
        title: `${tool_name} usage`,
        facts: [],
        narrative: null,
        files_read: [],
        files_modified: [],
      };
      const result = storeObservation(session.id, session.project, fallback, contentSessionId);
      return res.json({ ok: true, observationId: result.id, raw: true });
    }

    const result = storeObservation(session.id, session.project, parsed, contentSessionId);

    // Generate embedding asynchronously (non-blocking, fire-and-forget)
    if (!result.deduplicated) {
      embedObservation(getDb(), result.id, parsed.title, parsed.narrative, parsed.facts)
        .catch(err => console.error('[routes] embedding failed:', err));
    }

    res.json({ ok: true, observationId: result.id, deduplicated: result.deduplicated });
  } catch (error) {
    console.error('[routes] /api/observations error:', error);
    res.status(500).json({ error: 'Failed to store observation' });
  }
});

// Generate session summary
router.post('/api/summarize', async (req, res) => {
  try {
    const { contentSessionId, last_assistant_message } = req.body;
    if (!contentSessionId) {
      return res.status(400).json({ error: 'contentSessionId required' });
    }

    const session = getSessionByContentId(contentSessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!last_assistant_message) {
      return res.json({ ok: true, skipped: true, reason: 'no assistant message' });
    }

    const summary = await generateSummary(last_assistant_message);
    if (!summary) {
      return res.json({ ok: true, skipped: true, reason: 'AI summary failed' });
    }

    storeSummary(session.id, session.project, summary);
    res.json({ ok: true });
  } catch (error) {
    console.error('[routes] /api/summarize error:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Complete session
router.post('/api/sessions/complete', (req, res) => {
  try {
    const { contentSessionId } = req.body;
    if (!contentSessionId) {
      return res.status(400).json({ error: 'contentSessionId required' });
    }
    completeSession(contentSessionId);
    res.json({ ok: true });
  } catch (error) {
    console.error('[routes] /api/sessions/complete error:', error);
    res.status(500).json({ error: 'Failed to complete session' });
  }
});

// --- Dashboard API routes ---

// List all sessions (with summary + observation count)
router.get('/api/dashboard/sessions', (req, res) => {
  try {
    const project = req.query.project as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const db = getDb();

    const whereClause = project ? 'WHERE s.project = ?' : '';
    const params = project ? [project, limit, offset] : [limit, offset];

    const sessions = db.query(`
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

    const total = db.query(`SELECT COUNT(*) as count FROM sessions ${project ? 'WHERE project = ?' : ''}`).get(...(project ? [project] : [])) as { count: number };

    res.json({ sessions, total: total.count });
  } catch (error) {
    console.error('[routes] /api/dashboard/sessions error:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Get observations for a session
router.get('/api/dashboard/sessions/:sessionId/observations', (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const db = getDb();
    const observations = db.query(
      'SELECT * FROM observations WHERE session_id = ? ORDER BY created_at_epoch ASC'
    ).all(sessionId);
    res.json({ observations });
  } catch (error) {
    console.error('[routes] /api/dashboard/observations error:', error);
    res.status(500).json({ error: 'Failed to list observations' });
  }
});

// List all projects
router.get('/api/dashboard/projects', (_req, res) => {
  try {
    const db = getDb();
    const projects = db.query(`
      SELECT project, COUNT(*) as session_count,
        MAX(created_at) as last_active
      FROM sessions
      GROUP BY project
      ORDER BY last_active DESC
    `).all();
    res.json({ projects });
  } catch (error) {
    console.error('[routes] /api/dashboard/projects error:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// Stats
router.get('/api/dashboard/stats', (_req, res) => {
  try {
    const db = getDb();
    const sessions = db.query('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const activeSessions = db.query("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get() as { count: number };
    const observations = db.query('SELECT COUNT(*) as count FROM observations').get() as { count: number };
    const summaries = db.query('SELECT COUNT(*) as count FROM summaries').get() as { count: number };
    const projects = db.query('SELECT COUNT(DISTINCT project) as count FROM sessions').get() as { count: number };

    // Type breakdown
    const types = db.query(
      "SELECT type, COUNT(*) as count FROM observations GROUP BY type ORDER BY count DESC"
    ).all() as { type: string; count: number }[];

    // Recent activity (observations per day, last 7 days)
    const daily = db.query(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM observations
      WHERE created_at_epoch > ?
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all(Date.now() - 7 * 86400000) as { day: string; count: number }[];

    res.json({
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
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Recent feed (mixed observations + summaries, chronological)
router.get('/api/dashboard/feed', (req, res) => {
  try {
    const project = req.query.project as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;
    const before = req.query.before as string | undefined;
    const db = getDb();

    const conditions: string[] = [];
    const params: any[] = [];

    if (project) { conditions.push('project = ?'); params.push(project); }
    if (before) { conditions.push('created_at_epoch < ?'); params.push(parseInt(before)); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const observations = db.query(`
      SELECT id, session_id, project, type, title, facts, narrative,
        files_read, files_modified, created_at, created_at_epoch,
        'observation' as item_type
      FROM observations ${where}
      ORDER BY created_at_epoch DESC LIMIT ?
    `).all(...params, limit);

    const summaries = db.query(`
      SELECT id, session_id, project, request, investigated, learned,
        completed, next_steps, created_at, created_at_epoch,
        'summary' as item_type
      FROM summaries ${where}
      ORDER BY created_at_epoch DESC LIMIT ?
    `).all(...params, limit);

    const feed = [...observations, ...summaries]
      .sort((a: any, b: any) => b.created_at_epoch - a.created_at_epoch)
      .slice(0, limit);

    res.json({ feed });
  } catch (error) {
    console.error('[routes] /api/dashboard/feed error:', error);
    res.status(500).json({ error: 'Failed to get feed' });
  }
});

// Search (FTS5 or semantic)
router.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q as string;
    const project = req.query.project as string | undefined;
    const mode = (req.query.mode as string) || 'fts';
    const limit = parseInt(req.query.limit as string) || 10;

    if (!q) {
      return res.status(400).json({ error: 'q parameter required' });
    }

    if (mode === 'semantic') {
      const vecResults = await searchSemantic(getDb(), q, limit);
      if (vecResults.length === 0) {
        return res.json({ results: [], mode: 'semantic', message: 'No results (Ollama may be unavailable)' });
      }
      // Fetch full observation data for matched IDs
      const db = getDb();
      const enriched = vecResults.map(r => {
        const obs = db.query('SELECT * FROM observations WHERE id = ?').get(r.observationId) as any;
        return obs ? { ...obs, distance: r.distance } : null;
      }).filter(Boolean);
      return res.json({ results: enriched, mode: 'semantic' });
    }

    const results = searchObservationsFts(q, project, limit);
    res.json({ results, mode: 'fts' });
  } catch (error) {
    console.error('[routes] /api/search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});
