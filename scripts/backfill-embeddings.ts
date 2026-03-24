/**
 * Backfill embeddings for all observations that don't have one yet.
 * Usage: npx tsx scripts/backfill-embeddings.ts
 */

import { getDb } from '../src/db/database.js';
import { embedObservation } from '../src/embeddings/embeddings.js';

async function main() {
  const db = getDb();

  // Find observations without embeddings
  const missing = db.prepare(`
    SELECT o.id, o.title, o.narrative, o.facts
    FROM observations o
    LEFT JOIN observations_vec v ON v.observation_id = o.id
    WHERE v.observation_id IS NULL
    ORDER BY o.id ASC
  `).all() as { id: number; title: string | null; narrative: string | null; facts: string | null }[];

  console.log(`Found ${missing.length} observations without embeddings.`);
  if (missing.length === 0) return;

  let success = 0;
  let failed = 0;

  for (const obs of missing) {
    const facts = obs.facts ? JSON.parse(obs.facts) : [];
    const ok = await embedObservation(db, obs.id, obs.title, obs.narrative, facts);

    if (ok) {
      success++;
      process.stdout.write(`\r  ${success}/${missing.length} embedded`);
    } else {
      failed++;
      console.error(`\n  Failed: #${obs.id} (${obs.title})`);
    }
  }

  console.log(`\nDone: ${success} embedded, ${failed} failed.`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
