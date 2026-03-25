import { describe, it, expect } from 'vitest';
import { extractAssistantText } from '../../src/worker/message-processor.js';

describe('extractAssistantText', () => {
  it('extracts text from content blocks, filtering out thinking type', () => {
    const msg = {
      message: {
        content: [
          { type: 'thinking', text: 'internal thought' },
          { type: 'text', text: 'Hello world' },
        ],
      },
    };
    expect(extractAssistantText(msg)).toBe('Hello world');
  });

  it('joins multiple text blocks with newline', () => {
    const msg = {
      message: {
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'text', text: 'Line 2' },
        ],
      },
    };
    expect(extractAssistantText(msg)).toBe('Line 1\nLine 2');
  });

  it('returns string content directly', () => {
    const msg = { message: { content: 'plain string response' } };
    expect(extractAssistantText(msg)).toBe('plain string response');
  });

  it('returns empty string for null message', () => {
    expect(extractAssistantText(null)).toBe('');
  });

  it('returns empty string for undefined message', () => {
    expect(extractAssistantText(undefined)).toBe('');
  });

  it('returns empty string for message with no content', () => {
    expect(extractAssistantText({ message: {} })).toBe('');
  });

  it('returns empty string for message with null content', () => {
    expect(extractAssistantText({ message: { content: null } })).toBe('');
  });

  it('returns empty string when all blocks are thinking type', () => {
    const msg = {
      message: {
        content: [
          { type: 'thinking', text: 'thought 1' },
          { type: 'thinking', text: 'thought 2' },
        ],
      },
    };
    expect(extractAssistantText(msg)).toBe('');
  });
});
