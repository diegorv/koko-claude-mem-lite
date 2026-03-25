import { existsSync, readFileSync, writeFileSync } from 'fs';
import { getSettingsPath } from './paths.js';

export interface Settings {
  WORKER_PORT: number;
  OBSERVATION_COUNT: number;
  FULL_OBSERVATION_COUNT: number;
  SUMMARY_COUNT: number;
  OLLAMA_URL: string;
  OLLAMA_MODEL: string;
  SKIP_TOOLS: string;
}

const DEFAULTS: Settings = {
  WORKER_PORT: 37888,
  OBSERVATION_COUNT: 25,
  FULL_OBSERVATION_COUNT: 3,
  SUMMARY_COUNT: 2,
  OLLAMA_URL: 'http://localhost:11434',
  OLLAMA_MODEL: 'bge-m3',
  SKIP_TOOLS: 'Read,Glob,Grep,LSP',
};

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;

  const path = getSettingsPath();

  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULTS, null, 2));
    cached = { ...DEFAULTS };
    return cached;
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    cached = { ...DEFAULTS, ...raw };
    return cached!;
  } catch {
    cached = { ...DEFAULTS };
    return cached;
  }
}

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  const envVal = process.env[`MEMORY_LITE_${key}`];
  if (envVal !== undefined) {
    const def = DEFAULTS[key];
    if (typeof def === 'number') return Number(envVal) as Settings[K];
    return envVal as Settings[K];
  }
  return getSettings()[key];
}

export function getAllSettings(): Settings {
  return { ...getSettings() };
}

export function updateSettings(partial: Partial<Settings>): Settings {
  const current = getSettings();
  const updated = { ...current, ...partial };
  const path = getSettingsPath();
  writeFileSync(path, JSON.stringify(updated, null, 2));
  cached = updated;
  return updated;
}
