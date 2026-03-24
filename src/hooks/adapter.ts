/**
 * Claude Code hook adapter.
 * Normalizes stdin input and formats stdout output per the Claude Code hook contract.
 */

export interface NormalizedInput {
  sessionId: string | undefined;
  cwd: string;
  prompt: string | undefined;
  toolName: string | undefined;
  toolInput: string | undefined;
  toolResponse: string | undefined;
  transcriptPath: string | undefined;
}

export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext: string;
  };
  systemMessage?: string;
}

export function normalizeInput(raw: unknown): NormalizedInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    sessionId: (r.session_id ?? r.id ?? r.sessionId) as string | undefined,
    cwd: (r.cwd as string) || process.cwd(),
    prompt: r.prompt as string | undefined,
    toolName: r.tool_name as string | undefined,
    toolInput: typeof r.tool_input === 'string' ? r.tool_input : JSON.stringify(r.tool_input ?? ''),
    toolResponse: typeof r.tool_response === 'string' ? r.tool_response : JSON.stringify(r.tool_response ?? ''),
    transcriptPath: r.transcript_path as string | undefined,
  };
}

export function formatContextOutput(context: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  };
}

export function formatSilentOutput(): HookOutput {
  return {};
}
