/**
 * Privacy tag stripping.
 * Strips <private> tags at the hook layer (edge) before data reaches the worker/database.
 * Also strips <memory-lite-context> to prevent recursive storage.
 */

export function stripPrivateTags(content: string): string {
  return content
    .replace(/<memory-lite-context>[\s\S]*?<\/memory-lite-context>/g, '')
    .replace(/<private>[\s\S]*?<\/private>/g, '')
    .trim();
}

export function isEntirelyPrivate(content: string): boolean {
  return stripPrivateTags(content).length === 0;
}
