import { describe, it, expect, afterEach } from 'vitest';
import { getSetting, isProjectExcluded } from '../../src/utils/settings.js';

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

// Helper to run a test with EXCLUDED_PROJECTS set to a specific value
function withExcluded(value: string, fn: () => void): void {
  const key = 'MEMORY_LITE_EXCLUDED_PROJECTS';
  const prev = process.env[key];
  process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

describe('isProjectExcluded', () => {
  it('returns false when EXCLUDED_PROJECTS is empty', () => {
    withExcluded('', () => {
      expect(isProjectExcluded('my-project')).toBe(false);
    });
  });

  it('returns true for exact match', () => {
    withExcluded('secret-project', () => {
      expect(isProjectExcluded('secret-project')).toBe(true);
    });
  });

  it('returns false for non-matching project', () => {
    withExcluded('secret-project', () => {
      expect(isProjectExcluded('other-project')).toBe(false);
    });
  });

  it('matches any pattern in a comma-separated list', () => {
    withExcluded('alpha,beta,gamma', () => {
      expect(isProjectExcluded('alpha')).toBe(true);
      expect(isProjectExcluded('beta')).toBe(true);
      expect(isProjectExcluded('gamma')).toBe(true);
      expect(isProjectExcluded('delta')).toBe(false);
    });
  });

  it('supports * wildcard at end', () => {
    withExcluded('private-*', () => {
      expect(isProjectExcluded('private-notes')).toBe(true);
      expect(isProjectExcluded('private-work')).toBe(true);
      expect(isProjectExcluded('public-notes')).toBe(false);
    });
  });

  it('supports * wildcard at start', () => {
    withExcluded('*-secret', () => {
      expect(isProjectExcluded('work-secret')).toBe(true);
      expect(isProjectExcluded('my-secret')).toBe(true);
      expect(isProjectExcluded('my-public')).toBe(false);
    });
  });

  it('supports * wildcard matching any substring', () => {
    withExcluded('*temp*', () => {
      expect(isProjectExcluded('my-temp-dir')).toBe(true);
      expect(isProjectExcluded('temp')).toBe(true);
      expect(isProjectExcluded('normal')).toBe(false);
    });
  });

  it('is case-insensitive', () => {
    withExcluded('Secret-Project', () => {
      expect(isProjectExcluded('secret-project')).toBe(true);
      expect(isProjectExcluded('SECRET-PROJECT')).toBe(true);
    });
  });

  it('trims whitespace around patterns', () => {
    withExcluded('  alpha , beta  ', () => {
      expect(isProjectExcluded('alpha')).toBe(true);
      expect(isProjectExcluded('beta')).toBe(true);
    });
  });

  it('ignores empty patterns from trailing commas', () => {
    withExcluded('alpha,,beta,', () => {
      expect(isProjectExcluded('alpha')).toBe(true);
      expect(isProjectExcluded('beta')).toBe(true);
      expect(isProjectExcluded('')).toBe(false);
    });
  });

  it('does not partially match — full name must match', () => {
    withExcluded('secret', () => {
      expect(isProjectExcluded('secret-extra')).toBe(false);
      expect(isProjectExcluded('my-secret')).toBe(false);
      expect(isProjectExcluded('secret')).toBe(true);
    });
  });
});
