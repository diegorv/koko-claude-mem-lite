export const MAX_LIMIT = 500;
export const MAX_DEPTH = 50;
export const MAX_BATCH = 100;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function safeParseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}
