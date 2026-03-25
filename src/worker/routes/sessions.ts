import { Hono } from 'hono';
import {
  createSession, completeSession, getSessionByContentId,
  storeObservation, storeSummary,
} from '../../db/queries.js';
import { extractObservation, generateSummary } from '../summarizer.js';
import { getOrCreateObserver, getObserver, destroyObserver } from '../observer.js';
import { stripPrivateTags, isEntirelyPrivate } from '../../utils/privacy.js';
import { embedObservation } from '../../embeddings/embeddings.js';
import { getDb } from '../../db/database.js';
import { logger } from '../../utils/logger.js';
import { getSetting } from '../../utils/settings.js';

export const sessionRoutes = new Hono();

// Create/find session
sessionRoutes.post('/sessions', async (c) => {
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

// Complete session
sessionRoutes.post('/sessions/complete', async (c) => {
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

// Store observation (multi-turn observer — fire-and-forget to avoid blocking hooks)
sessionRoutes.post('/observations', async (c) => {
  try {
    const { contentSessionId, tool_name, tool_input, tool_response, cwd } = await c.req.json();
    if (!contentSessionId || !tool_name) {
      return c.json({ error: 'contentSessionId and tool_name required' }, 400);
    }

    const session = getSessionByContentId(contentSessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const skipTools = new Set(
      getSetting('SKIP_TOOLS').split(',').map((s: string) => s.trim()).filter(Boolean)
    );
    if (skipTools.has(tool_name)) {
      return c.json({ ok: true, skipped: true, reason: 'tool_excluded' });
    }

    const cleanInput = stripPrivateTags(tool_input || '');
    const cleanResponse = stripPrivateTags(tool_response || '');

    // Enqueue observation and return immediately — don't block the hook process
    const observer = getObserver(contentSessionId);
    if (observer) {
      observer.pushObservation(tool_name, cleanInput, cleanResponse, cwd).catch(err => {
        logger.error('routes', 'Observer pushObservation error', err);
      });
      return c.json({ ok: true, queued: true });
    }

    // No observer session — fire-and-forget fallback so the hook is never blocked
    const sessionId = session.id;
    const project = session.project;
    extractObservation(tool_name, cleanInput, cleanResponse, cwd).then(parsed => {
      if (!parsed || parsed.type === 'skip') return;
      const result = storeObservation(sessionId, project, parsed, contentSessionId);
      if (!result.deduplicated) {
        embedObservation(getDb(), result.id, parsed.title, parsed.narrative, parsed.facts)
          .catch(err => logger.error('routes', 'embedding failed', err));
      }
    }).catch(err => logger.error('routes', 'extractObservation fallback error', err));

    return c.json({ ok: true, queued: true });
  } catch (error) {
    logger.error('routes', '/api/observations error', error);
    return c.json({ error: 'Failed to store observation' }, 500);
  }
});

// Generate session summary
sessionRoutes.post('/summarize', async (c) => {
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
