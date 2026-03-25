import { describe, it, expect } from 'vitest';
import { truncate, buildInitPrompt, buildObservationPrompt, buildSummaryPrompt, OBSERVER_SYSTEM_PROMPT, OBSERVATION_EXTRACTION_PROMPT, CLEANUP_SYSTEM_PROMPT } from '../../src/worker/prompts.js';

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

describe('OBSERVER_SYSTEM_PROMPT', () => {
  it('includes subtitle in XML schema', () => {
    expect(OBSERVER_SYSTEM_PROMPT).toContain('<subtitle>');
  });

  it('includes concepts in XML schema', () => {
    expect(OBSERVER_SYSTEM_PROMPT).toContain('<concepts>');
    expect(OBSERVER_SYSTEM_PROMPT).toContain('<concept>');
  });

  it('includes spatial awareness section', () => {
    expect(OBSERVER_SYSTEM_PROMPT).toContain('SPATIAL AWARENESS');
  });

  it('includes refactor as valid type', () => {
    expect(OBSERVER_SYSTEM_PROMPT).toContain('refactor');
  });

  it('includes fact quality guidance about no pronouns', () => {
    expect(OBSERVER_SYSTEM_PROMPT).toContain('no pronouns');
  });

  it('does not include files_read in output schema (aligned with extraction prompt)', () => {
    // files_read is noise — git blame covers it. Only files_modified matters.
    const outputSection = OBSERVER_SYSTEM_PROMPT.split('OUTPUT FORMAT')[1] || '';
    expect(outputSection).not.toContain('<files_read>');
    expect(outputSection).toContain('<files_modified>');
  });

  it('includes TITLE EXAMPLES section', () => {
    expect(OBSERVER_SYSTEM_PROMPT).toContain('TITLE EXAMPLES');
    expect(OBSERVER_SYSTEM_PROMPT).toContain('GOOD:');
    expect(OBSERVER_SYSTEM_PROMPT).toContain('BAD:');
  });
});

describe('OBSERVATION_EXTRACTION_PROMPT', () => {
  it('includes subtitle in XML schema', () => {
    expect(OBSERVATION_EXTRACTION_PROMPT).toContain('<subtitle>');
  });

  it('includes concepts in XML schema', () => {
    expect(OBSERVATION_EXTRACTION_PROMPT).toContain('<concepts>');
  });

  it('includes refactor as valid type', () => {
    expect(OBSERVATION_EXTRACTION_PROMPT).toContain('refactor');
  });

  it('asks for what-was-done narrative not just why-it-matters', () => {
    expect(OBSERVATION_EXTRACTION_PROMPT).toContain('What was done, how it works, why it matters');
  });

  it('does not skip comparative codebase analysis', () => {
    expect(OBSERVATION_EXTRACTION_PROMPT).not.toContain('Comparing two projects/codebases');
  });

  it('includes spatial awareness', () => {
    expect(OBSERVATION_EXTRACTION_PROMPT).toContain('SPATIAL AWARENESS');
  });

  it('includes fact standalone guidance', () => {
    expect(OBSERVATION_EXTRACTION_PROMPT).toContain('stand alone');
  });
});

describe('CLEANUP_SYSTEM_PROMPT', () => {
  it('does not filter self-referential observations about the memory plugin', () => {
    expect(CLEANUP_SYSTEM_PROMPT).not.toContain('Self-referential observations about the memory plugin');
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
