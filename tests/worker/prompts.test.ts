import { describe, it, expect } from 'vitest';
import { truncate, buildInitPrompt, buildObservationPrompt, buildSummaryPrompt } from '../../src/worker/prompts.js';

describe('truncate', () => {
  it('returns string unchanged when under maxLen', () => {
    expect(truncate('short', 100)).toBe('short');
  });

  it('truncates and appends marker when over maxLen', () => {
    const result = truncate('a'.repeat(200), 100);
    expect(result.length).toBeLessThanOrEqual(100 + '... [truncated]'.length);
    expect(result).toContain('... [truncated]');
  });

  it('returns string unchanged at exact maxLen', () => {
    const str = 'a'.repeat(50);
    expect(truncate(str, 50)).toBe(str);
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });
});

describe('buildInitPrompt', () => {
  it('includes project name', () => {
    const result = buildInitPrompt('my-project');
    expect(result).toContain('my-project');
  });

  it('includes user prompt when provided', () => {
    const result = buildInitPrompt('proj', 'fix the bug');
    expect(result).toContain('fix the bug');
    expect(result).toContain('User request:');
  });

  it('omits user prompt line when undefined', () => {
    const result = buildInitPrompt('proj');
    expect(result).not.toContain('User request:');
  });

  it('includes OBSERVER_SYSTEM_PROMPT content', () => {
    const result = buildInitPrompt('proj');
    expect(result).toContain('MEMORY PROCESSING START');
    expect(result).toContain('Session started for project:');
  });
});

describe('buildObservationPrompt', () => {
  it('includes tool name, input, and response', () => {
    const result = buildObservationPrompt('Read', 'file.ts', 'content here');
    expect(result).toContain('Read');
    expect(result).toContain('file.ts');
    expect(result).toContain('content here');
  });

  it('wraps in <observed_from_primary_session> tags', () => {
    const result = buildObservationPrompt('Edit', 'input', 'output');
    expect(result).toContain('<observed_from_primary_session>');
    expect(result).toContain('</observed_from_primary_session>');
  });

  it('truncates long input at 2000 chars', () => {
    const longInput = 'x'.repeat(5000);
    const result = buildObservationPrompt('Tool', longInput, 'out');
    expect(result).toContain('... [truncated]');
    expect(result).not.toContain('x'.repeat(5000));
  });

  it('truncates long response at 3000 chars', () => {
    const longResponse = 'y'.repeat(5000);
    const result = buildObservationPrompt('Tool', 'in', longResponse);
    expect(result).toContain('... [truncated]');
    expect(result).not.toContain('y'.repeat(5000));
  });

  it('includes cwd when provided', () => {
    const result = buildObservationPrompt('Tool', 'in', 'out', '/home/user/project');
    expect(result).toContain('<working_directory>/home/user/project</working_directory>');
  });

  it('omits cwd when undefined', () => {
    const result = buildObservationPrompt('Tool', 'in', 'out');
    expect(result).not.toContain('working_directory');
  });

  it('includes ISO timestamp', () => {
    const result = buildObservationPrompt('Tool', 'in', 'out');
    expect(result).toMatch(/<occurred_at>\d{4}-\d{2}-\d{2}T/);
  });
});

describe('buildSummaryPrompt', () => {
  it('includes the assistant message', () => {
    const result = buildSummaryPrompt('I fixed the authentication bug.');
    expect(result).toContain('I fixed the authentication bug.');
  });

  it('includes summary format instructions', () => {
    const result = buildSummaryPrompt('msg');
    expect(result).toContain('<summary>');
    expect(result).toContain('MODE SWITCH: PROGRESS SUMMARY');
  });

  it('truncates long messages at 5000 chars', () => {
    const longMsg = 'z'.repeat(10000);
    const result = buildSummaryPrompt(longMsg);
    expect(result).toContain('... [truncated]');
    expect(result).not.toContain('z'.repeat(10000));
  });
});
