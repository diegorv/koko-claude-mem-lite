/**
 * Embedding generation via Ollama and vector search via sqlite-vec.
 * Graceful degradation: if Ollama is unavailable, operations silently skip.
 */

import { Database } from 'bun:sqlite';
import { getSetting } from '../utils/settings.js';

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
export function storeEmbedding(db: Database, observationId: number, embedding: Float32Array): boolean {
  try {
    db.run(
      'INSERT OR REPLACE INTO observations_vec (observation_id, embedding) VALUES (?, ?)',
      [observationId, embedding]
    );
    return true;
  } catch (error) {
    console.error('[embeddings] Failed to store embedding:', error);
    return false;
  }
}

/**
 * Semantic search: find observations similar to the query text.
 */
export async function searchSemantic(
  db: Database,
  query: string,
  limit: number = 10
): Promise<{ observationId: number; distance: number }[]> {
  const embedding = await generateEmbedding(query);
  if (!embedding) return [];

  try {
    const results = db.query(
      `SELECT observation_id, distance
       FROM observations_vec
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`
    ).all(embedding, limit) as { observation_id: number; distance: number }[];

    return results.map(r => ({
      observationId: r.observation_id,
      distance: r.distance,
    }));
  } catch (error) {
    console.error('[embeddings] Semantic search failed:', error);
    return [];
  }
}

/**
 * Generate and store embedding for an observation.
 * Combines title + narrative + facts into a single text for embedding.
 */
export async function embedObservation(
  db: Database,
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
