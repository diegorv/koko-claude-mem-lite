/**
 * Stdin reader for Claude Code hooks.
 *
 * Claude Code doesn't close stdin after writing, so stdin.on('end') never fires.
 * Solution: JSON is self-delimiting — we detect complete JSON by parsing after each chunk.
 * Adapted from claude-mem's src/cli/stdin-reader.ts.
 */

const SAFETY_TIMEOUT_MS = 30_000;
const PARSE_DELAY_MS = 50;

function isStdinAvailable(): boolean {
  try {
    const stdin = process.stdin;
    if (stdin.isTTY) return false;
    // Trigger Bun's lazy initialization — if this throws, stdin is unavailable
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    stdin.readable;
    return true;
  } catch {
    return false;
  }
}

function tryParseJson(input: string): unknown | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export async function readJsonFromStdin(): Promise<unknown> {
  if (!isStdinAvailable()) return undefined;

  return new Promise((resolve) => {
    let input = '';
    let resolved = false;
    let parseDelayId: ReturnType<typeof setTimeout> | null = null;

    const done = (value: unknown) => {
      if (resolved) return;
      resolved = true;
      if (parseDelayId) clearTimeout(parseDelayId);
      clearTimeout(safetyTimeoutId);
      try {
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        process.stdin.removeAllListeners('error');
      } catch { /* ignore */ }
      resolve(value);
    };

    const tryResolve = (): boolean => {
      const parsed = tryParseJson(input);
      if (parsed !== undefined) {
        done(parsed);
        return true;
      }
      return false;
    };

    const safetyTimeoutId = setTimeout(() => {
      if (!resolved) {
        if (!tryResolve()) done(undefined);
      }
    }, SAFETY_TIMEOUT_MS);

    try {
      process.stdin.on('data', (chunk) => {
        input += chunk;
        if (parseDelayId) {
          clearTimeout(parseDelayId);
          parseDelayId = null;
        }
        if (tryResolve()) return;
        parseDelayId = setTimeout(tryResolve, PARSE_DELAY_MS);
      });

      process.stdin.on('end', () => {
        if (!resolved) {
          if (!tryResolve()) done(undefined);
        }
      });

      process.stdin.on('error', () => {
        if (!resolved) done(undefined);
      });
    } catch {
      resolved = true;
      clearTimeout(safetyTimeoutId);
      resolve(undefined);
    }
  });
}
