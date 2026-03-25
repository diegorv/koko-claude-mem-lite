import { Hono } from 'hono';
import {
  searchObservationsFts, searchObservationsIndex,
  getObservationsByIds, getTimelineAroundObservation,
} from '../../db/queries.js';
import { formatSearchIndex, formatTimeline, formatObservationsFull } from '../formatter.js';
import { searchSemantic } from '../../embeddings/embeddings.js';
import { getDb } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import { clamp, safeParseInt, MAX_LIMIT, MAX_DEPTH, MAX_BATCH } from './utils.js';

export const searchRoutes = new Hono();

searchRoutes.get('/search/index', (c) => {
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

searchRoutes.get('/timeline', (c) => {
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

searchRoutes.post('/observations/batch', async (c) => {
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

searchRoutes.get('/search', async (c) => {
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
