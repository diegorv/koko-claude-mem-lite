/**
 * Structured file logger for the background worker.
 * Writes to ~/.memory-lite/worker.log with timestamps and log levels.
 * Falls back to stderr if log file is unavailable.
 */

import { appendFileSync } from 'fs';
import { getLogPath } from './paths.js';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

let logPath: string | null = null;

function getPath(): string {
  if (!logPath) logPath = getLogPath();
  return logPath;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function write(level: LogLevel, component: string, message: string, data?: unknown): void {
  const parts = [`[${timestamp()}]`, `[${level.padEnd(5)}]`, `[${component}]`, message];
  if (data !== undefined) {
    try {
      parts.push(typeof data === 'string' ? data : JSON.stringify(data));
    } catch {}
  }
  const line = parts.join(' ') + '\n';

  try {
    appendFileSync(getPath(), line);
  } catch {
    process.stderr.write(line);
  }
}

export const logger = {
  debug: (component: string, message: string, data?: unknown) => write('DEBUG', component, message, data),
  info:  (component: string, message: string, data?: unknown) => write('INFO', component, message, data),
  warn:  (component: string, message: string, data?: unknown) => write('WARN', component, message, data),
  error: (component: string, message: string, data?: unknown) => write('ERROR', component, message, data),
};
