import { describe, it, expect } from 'vitest';
import { normalizeInput, formatContextOutput, formatSilentOutput } from '../../src/hooks/adapter.js';

describe('normalizeInput', () => {
  it('extracts session_id from raw', () => {
    const result = normalizeInput({ session_id: 'abc' });
    expect(result.sessionId).toBe('abc');
  });

  it('falls back to id when session_id missing', () => {
    const result = normalizeInput({ id: 'fallback-id' });
    expect(result.sessionId).toBe('fallback-id');
  });

  it('falls back to sessionId as last resort', () => {
    const result = normalizeInput({ sessionId: 'last-resort' });
    expect(result.sessionId).toBe('last-resort');
  });

  it('defaults cwd to process.cwd() when missing', () => {
    const result = normalizeInput({});
    expect(result.cwd).toBe(process.cwd());
  });

  it('uses provided cwd', () => {
    const result = normalizeInput({ cwd: '/custom/path' });
    expect(result.cwd).toBe('/custom/path');
  });

  it('stringifies object tool_input', () => {
    const result = normalizeInput({ tool_input: { key: 'value' } });
    expect(result.toolInput).toBe('{"key":"value"}');
  });

  it('passes string tool_input unchanged', () => {
    const result = normalizeInput({ tool_input: 'raw string' });
    expect(result.toolInput).toBe('raw string');
  });

  it('stringifies object tool_response', () => {
    const result = normalizeInput({ tool_response: { data: 1 } });
    expect(result.toolResponse).toBe('{"data":1}');
  });

  it('handles null raw gracefully', () => {
    const result = normalizeInput(null);
    expect(result.sessionId).toBeUndefined();
    expect(result.cwd).toBe(process.cwd());
  });

  it('handles undefined raw gracefully', () => {
    const result = normalizeInput(undefined);
    expect(result.sessionId).toBeUndefined();
  });

  it('extracts prompt', () => {
    const result = normalizeInput({ prompt: 'do something' });
    expect(result.prompt).toBe('do something');
  });

  it('extracts tool_name', () => {
    const result = normalizeInput({ tool_name: 'Read' });
    expect(result.toolName).toBe('Read');
  });

  it('extracts transcript_path', () => {
    const result = normalizeInput({ transcript_path: '/tmp/transcript.json' });
    expect(result.transcriptPath).toBe('/tmp/transcript.json');
  });
});

describe('formatContextOutput', () => {
  it('wraps context in hookSpecificOutput', () => {
    const result = formatContextOutput('memory context here');
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput!.additionalContext).toBe('memory context here');
  });

  it('sets hookEventName to SessionStart', () => {
    const result = formatContextOutput('ctx');
    expect(result.hookSpecificOutput!.hookEventName).toBe('SessionStart');
  });
});

describe('formatSilentOutput', () => {
  it('returns empty object', () => {
    const result = formatSilentOutput();
    expect(result).toEqual({});
  });
});
