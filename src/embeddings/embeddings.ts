/**
 * Embedding generation via Ollama and vector search via sqlite-vec.
 * Graceful degradation: if Ollama is unavailable, operations silently skip.
 */

import type Database from 'better-sqlite3';
import { getSetting } from '../utils/settings.js';
import { logger } from '../utils/logger.js';

/**
 * Generate embedding for text via Ollama API.
 * Returns null if Ollama is unavailable.
 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  const ollamaUrl = getSetting('OLLAMA_URL');
  const model = getSetting('OLLAMA_MODEL');

  try {
    const response = await fetch(`${ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    });

    if (!response.ok) return null;

    const data = await response.json() as { embeddings: number[][] };
    if (!data.embeddings?.[0]) return null;

    return new Float32Array(data.embeddings[0]);
  } catch {
    // Ollama unavailable — graceful degradation
    return null;
  }
}

/**
 * Store embedding for an observation.
 */
const EXPECTED_EMBEDDING_DIM = 1024;

export function storeEmbedding(db: Database.Database, observationId: number, embedding: Float32Array): boolean {
  if (embedding.length !== EXPECTED_EMBEDDING_DIM) {
    logger.error('embeddings', `Dimension mismatch: got ${embedding.length}, expected ${EXPECTED_EMBEDDING_DIM}. Skipping storage.`);
    return false;
  }
  try {
    db.prepare(
      'INSERT OR REPLACE INTO observations_vec (observation_id, embedding) VALUES (CAST(? AS INTEGER), vec_f32(?))'
    ).run(observationId, Buffer.from(embedding.buffer));
    return true;
  } catch (error) {
    logger.error('embeddings', 'Failed to store embedding', error);
    return false;
  }
}

/**
 * Semantic search: find observations similar to the query text.
 */
export async function searchSemantic(
  db: Database.Database,
  query: string,
  limit: number = 10
): Promise<{ observationId: number; distance: number }[]> {
  const embedding = await generateEmbedding(query);
  if (!embedding) return [];

  try {
    const results = db.prepare(
      `SELECT observation_id, distance
       FROM observations_vec
       WHERE embedding MATCH vec_f32(?)
       ORDER BY distance
       LIMIT ?`
    ).all(Buffer.from(embedding.buffer), limit) as { observation_id: number; distance: number }[];

    return results.map(r => ({
      observationId: r.observation_id,
      distance: r.distance,
    }));
  } catch (error) {
    logger.error('embeddings', 'Semantic search failed', error);
    return [];
  }
}

/**
 * Generate and store embedding for an observation.
 * Combines title + narrative + facts into a single text for embedding.
 */
export async function embedObservation(
  db: Database.Database,
  observationId: number,
  title: string | null,
  narrative: string | null,
  facts: string[]
): Promise<boolean> {
  const parts: string[] = [];
  if (title) parts.push(title);
  if (narrative) parts.push(narrative);
  if (facts.length > 0) parts.push(facts.join('. '));

  const text = parts.join(' — ');
  if (!text) return false;

  const embedding = await generateEmbedding(text);
  if (!embedding) return false;

  return storeEmbedding(db, observationId, embedding);
}
