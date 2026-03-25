import { describe, it, expect, vi } from 'vitest';
import { extractAssistantText, processMessage, type PendingResult } from '../../src/worker/message-processor.js';
import type { ParsedObservation, ParsedSummary } from '../../src/worker/xml-parser.js';
import type { PendingMessage } from '../../src/db/pending-store.js';

vi.mock('../../src/db/pending-store.js', () => ({
  deletePending: vi.fn(),
}));
vi.mock('../../src/db/database.js', () => ({
  getDb: vi.fn(() => ({})),
}));
vi.mock('../../src/embeddings/embeddings.js', () => ({
  embedObservation: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/db/queries.js', () => ({
  storeObservation: vi.fn(),
  storeSummary: vi.fn(),
  getSessionByContentId: vi.fn(),
}));
vi.mock('../../src/worker/xml-parser.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/worker/xml-parser.js')>();
  return { ...actual, parseObservationXml: vi.fn(actual.parseObservationXml), parseSummaryXml: vi.fn(actual.parseSummaryXml) };
});

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

describe('processMessage', () => {
  function makePending(id: number, kind: 'observation' | 'summary'): PendingMessage {
    return { id, content_session_id: 'sess-1', kind, prompt: 'test', status: 'processing', created_at_epoch: Date.now() };
  }

  it('resolves pending promise even when storeObservation throws', async () => {
    const { storeObservation, getSessionByContentId } = await import('../../src/db/queries.js');
    vi.mocked(getSessionByContentId).mockReturnValue({ id: 1, project: 'proj' } as any);
    vi.mocked(storeObservation).mockImplementation(() => { throw new Error('DB write failed'); });

    const { parseObservationXml } = await import('../../src/worker/xml-parser.js');
    vi.mocked(parseObservationXml).mockReturnValue({ type: 'feature', title: 'test', subtitle: null, narrative: '', facts: [], concepts: [], files_read: [], files_modified: [] });

    const pendingResults = new Map<number, PendingResult<ParsedObservation | ParsedSummary | null>>();
    const promise = new Promise<ParsedObservation | ParsedSummary | null>((resolve) => {
      pendingResults.set(42, { resolve });
    });

    const msg = makePending(42, 'observation');
    processMessage(msg, '<observation>test</observation>', 'sess-1', pendingResults);

    // Promise must resolve (not hang), and pending entry must be cleaned up
    const result = await promise;
    expect(result).not.toBeUndefined();
    expect(pendingResults.size).toBe(0);
  });

  it('resolves pending promise even when storeSummary throws', async () => {
    const { storeSummary, getSessionByContentId } = await import('../../src/db/queries.js');
    vi.mocked(getSessionByContentId).mockReturnValue({ id: 1, project: 'proj' } as any);
    vi.mocked(storeSummary).mockImplementation(() => { throw new Error('DB write failed'); });

    const { parseSummaryXml } = await import('../../src/worker/xml-parser.js');
    vi.mocked(parseSummaryXml).mockReturnValue({ request: 'r', investigated: 'i', learned: 'l', completed: 'c', next_steps: 'n' });

    const pendingResults = new Map<number, PendingResult<ParsedObservation | ParsedSummary | null>>();
    const promise = new Promise<ParsedObservation | ParsedSummary | null>((resolve) => {
      pendingResults.set(43, { resolve });
    });

    const msg = makePending(43, 'summary');
    processMessage(msg, '<summary>test</summary>', 'sess-1', pendingResults);

    const result = await promise;
    expect(result).not.toBeUndefined();
    expect(pendingResults.size).toBe(0);
  });

  it('resolves pending promise with null for empty text', () => {
    const pendingResults = new Map<number, PendingResult<ParsedObservation | ParsedSummary | null>>();
    let resolved = false;
    let resolvedValue: any;
    pendingResults.set(44, { resolve: (v) => { resolved = true; resolvedValue = v; } });

    const msg = makePending(44, 'observation');
    processMessage(msg, '', 'sess-1', pendingResults);

    expect(resolved).toBe(true);
    expect(resolvedValue).toBeNull();
    expect(pendingResults.size).toBe(0);
  });
});
