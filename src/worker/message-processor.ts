/**
 * Processes SDK responses: parses XML, stores observations/summaries,
 * triggers embeddings, and manages pending message lifecycle.
 */

import { parseObservationXml, parseSummaryXml, type ParsedObservation, type ParsedSummary } from './summarizer.js';
import { deletePending, type PendingMessage } from '../db/pending-store.js';
import { storeObservation, storeSummary, getSessionByContentId } from '../db/queries.js';
import { embedObservation } from '../embeddings/embeddings.js';
import { getDb } from '../db/database.js';
import { logger } from '../utils/logger.js';

export interface PendingResult<T> {
  resolve: (value: T) => void;
}

export function processMessage(
  msg: PendingMessage,
  text: string,
  contentSessionId: string,
  pendingResults: Map<number, PendingResult<ParsedObservation | ParsedSummary | null>>,
): void {
  if (msg.kind === 'observation' && text) {
    processObservation(msg, text, contentSessionId, pendingResults);
  } else if (msg.kind === 'summary' && text) {
    processSummary(msg, text, contentSessionId, pendingResults);
  } else {
    // Empty text — nothing to store, safe to delete
    deletePending(msg.id);
    resolvePending(msg.id, null, pendingResults);
  }
}

function processObservation(
  msg: PendingMessage,
  text: string,
  contentSessionId: string,
  pendingResults: Map<number, PendingResult<ParsedObservation | ParsedSummary | null>>,
): void {
  const parsed = parseObservationXml(text);
  if (parsed && parsed.type !== 'skip') {
    const session = getSessionByContentId(contentSessionId);
    if (session) {
      try {
        const result = storeObservation(session.id, session.project, parsed, contentSessionId);
        deletePending(msg.id);
        if (!result.deduplicated) {
          embedObservation(getDb(), result.id, parsed.title, parsed.narrative, parsed.facts)
            .catch(err => logger.error('message-processor', 'embedding failed', err));
        }
      } catch (err) {
        logger.error('message-processor', 'Failed to store observation', err);
        return;
      }
    } else {
      deletePending(msg.id);
    }
  } else {
    deletePending(msg.id);
  }
  resolvePending(msg.id, parsed ?? null, pendingResults);
}

function processSummary(
  msg: PendingMessage,
  text: string,
  contentSessionId: string,
  pendingResults: Map<number, PendingResult<ParsedObservation | ParsedSummary | null>>,
): void {
  const parsed = parseSummaryXml(text);
  if (parsed) {
    const session = getSessionByContentId(contentSessionId);
    if (session) {
      try {
        storeSummary(session.id, session.project, parsed);
        deletePending(msg.id);
      } catch (err) {
        logger.error('message-processor', 'Failed to store summary', err);
        return;
      }
    } else {
      deletePending(msg.id);
    }
  } else {
    deletePending(msg.id);
  }
  resolvePending(msg.id, parsed ?? null, pendingResults);
}

function resolvePending(
  msgId: number,
  value: ParsedObservation | ParsedSummary | null,
  pendingResults: Map<number, PendingResult<ParsedObservation | ParsedSummary | null>>,
): void {
  const pending = pendingResults.get(msgId);
  if (pending) {
    pendingResults.delete(msgId);
    pending.resolve(value);
  }
}

export function extractAssistantText(message: any): string {
  const content = message?.message?.content;
  if (Array.isArray(content)) {
    return content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  }
  return typeof content === 'string' ? content : '';
}
