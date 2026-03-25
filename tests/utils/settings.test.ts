import { describe, it, expect, afterEach } from 'vitest';
import { getSetting } from '../../src/utils/settings.js';

describe('getSetting', () => {
  afterEach(() => {
    delete process.env.MEMORY_LITE_WORKER_PORT;
    delete process.env.MEMORY_LITE_OLLAMA_URL;
  });

  it('returns default when env var is non-numeric for number settings', () => {
    process.env.MEMORY_LITE_WORKER_PORT = 'not-a-number';
    expect(getSetting('WORKER_PORT')).toBe(37888);
  });

  it('returns parsed number when env var is valid', () => {
    process.env.MEMORY_LITE_WORKER_PORT = '9999';
    expect(getSetting('WORKER_PORT')).toBe(9999);
  });

  it('returns env var value for string settings', () => {
    process.env.MEMORY_LITE_OLLAMA_URL = 'http://custom:1234';
    expect(getSetting('OLLAMA_URL')).toBe('http://custom:1234');
  });
});
