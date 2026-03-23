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
