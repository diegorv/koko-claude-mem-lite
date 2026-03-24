import { createHash } from 'crypto';

/**
 * Compute a short content hash for deduplication.
 * Uses (sessionId + title + narrative) as the semantic identity.
 */
export function computeContentHash(
  sessionId: string,
  title: string | null,
  narrative: string | null
): string {
  return createHash('sha256')
    .update((sessionId || '') + (title || '') + (narrative || ''))
    .digest('hex')
    .slice(0, 16);
}
