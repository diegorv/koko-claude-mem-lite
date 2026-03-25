/**
 * Estimates the number of tokens in a text string.
 *
 * Uses a word-boundary approach: split on whitespace, then multiply by 1.3
 * to account for subword tokenization and punctuation overhead. This is
 * more accurate than the naive `length / 4` heuristic for mixed prose/code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}
