import { Hono } from 'hono';
import {
  getRecentObservations, getRecentSummaries,
  deleteObservation, deleteSummary,
} from '../../db/queries.js';
import { reviewForCleanup, type CleanupItem } from '../summarizer.js';
import { logger } from '../../utils/logger.js';

export const cleanupRoutes = new Hono();

cleanupRoutes.post('/cleanup/review', async (c) => {
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

          send('items', { items: items.map(i => ({ id: i.id, type: i.type, text: i.text })) });

          try {
            const results = await reviewForCleanup(items);
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

cleanupRoutes.post('/cleanup/apply', async (c) => {
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
