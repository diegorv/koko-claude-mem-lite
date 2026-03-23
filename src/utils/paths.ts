import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.memory-lite');

export function getDataDir(): string {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
}

export function getDbPath(): string {
  return join(getDataDir(), 'data.db');
}

export function getPidPath(): string {
  return join(getDataDir(), 'worker.pid');
}

export function getSettingsPath(): string {
  return join(getDataDir(), 'settings.json');
}

export function getLogPath(): string {
  return join(getDataDir(), 'worker.log');
}

export function getProjectName(cwd: string): string {
  return cwd.split('/').pop() || 'unknown';
}
