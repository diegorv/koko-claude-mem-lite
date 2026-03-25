/**
 * SQLite-backed async message queue with idle timeout.
 * Messages survive worker crashes thanks to persistence in pending-store.
 */

import { EventEmitter } from 'events';
import { enqueuePending, claimNextPending, type PendingMessage } from '../db/pending-store.js';
import { logger } from '../utils/logger.js';

export type { PendingMessage } from '../db/pending-store.js';

const IDLE_TIMEOUT_MS = 3 * 60 * 1000;

export class DurableQueue {
  private emitter = new EventEmitter();
  private closed = false;
  private contentSessionId: string;
  private signal?: AbortSignal;

  constructor(contentSessionId: string, signal?: AbortSignal) {
    this.contentSessionId = contentSessionId;
    this.signal = signal;
  }

  push(kind: 'observation' | 'summary', prompt: string): number {
    const id = enqueuePending(this.contentSessionId, kind, prompt);
    this.emitter.emit('message');
    return id;
  }

  close(): void {
    this.closed = true;
    this.emitter.emit('message'); // wake any waiting iterator
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<PendingMessage> {
    let iterCount = 0;
    while (!this.closed && !this.signal?.aborted) {
      iterCount++;
      let msg: PendingMessage | null = null;
      try {
        msg = claimNextPending(this.contentSessionId);
      } catch (err) {
        logger.error('queue', `Error claiming message (iter=${iterCount}), backing off`, err);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (msg) {
        logger.info('queue', `Claimed message id=${msg.id} kind=${msg.kind} (iter=${iterCount}) for ${this.contentSessionId}`);
        yield msg;
        continue;
      }

      logger.info('queue', `No pending messages, waiting (iter=${iterCount}) for ${this.contentSessionId}`);
      // Wait for new message or timeout
      const gotMessage = await new Promise<boolean>((resolve) => {
        const onMessage = () => {
          clearTimeout(timer);
          this.signal?.removeEventListener('abort', onAbort);
          resolve(true);
        };
        const onAbort = () => {
          clearTimeout(timer);
          this.emitter.removeListener('message', onMessage);
          resolve(false);
        };
        const timer = setTimeout(() => {
          this.emitter.removeListener('message', onMessage);
          this.signal?.removeEventListener('abort', onAbort);
          resolve(false);
        }, IDLE_TIMEOUT_MS);

        this.emitter.once('message', onMessage);
        this.signal?.addEventListener('abort', onAbort, { once: true });
      });

      if (!gotMessage) {
        if (this.signal?.aborted) {
          logger.info('queue', `Aborted signal received (iter=${iterCount}) for ${this.contentSessionId}`);
          break;
        }
        // Final check: stuck messages may now be past STUCK_TIMEOUT_MS
        logger.info('queue', `Idle timeout, final check (iter=${iterCount}) for ${this.contentSessionId}`);
        const recovered = claimNextPending(this.contentSessionId);
        if (recovered) {
          logger.info('queue', `Recovered stuck message id=${recovered.id} (iter=${iterCount})`);
          yield recovered;
          continue;
        }
        logger.info('queue', `No stuck messages, exiting iterator for ${this.contentSessionId}`);
        break;
      }
    }
    logger.info('queue', `Iterator exited (iter=${iterCount}, closed=${this.closed}, aborted=${this.signal?.aborted}) for ${this.contentSessionId}`);
  }
}
