#!/usr/bin/env node
/**
 * Setup script for memory-lite plugin.
 * Ensures native dependencies (better-sqlite3, sqlite-vec) are installed.
 * Runs on SessionStart before the worker is spawned.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

function resolveRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    const root = process.env.CLAUDE_PLUGIN_ROOT;
    if (existsSync(join(root, 'package.json'))) return root;
  }
  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    return dirname(scriptDir);
  } catch {
    return null;
  }
}

const ROOT = resolveRoot();
if (!ROOT) {
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
}

const MARKER = join(ROOT, '.install-version');

function needsInstall() {
  if (!existsSync(join(ROOT, 'node_modules'))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const marker = JSON.parse(readFileSync(MARKER, 'utf-8'));
    return pkg.version !== marker.version;
  } catch {
    return true;
  }
}

function installDeps() {
  console.error('[memory-lite] Installing native dependencies...');
  try {
    execSync('npm install --production', {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
  } catch (err) {
    console.error('[memory-lite] npm install failed:', err.message);
    throw err;
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  writeFileSync(MARKER, JSON.stringify({
    version: pkg.version,
    installedAt: new Date().toISOString(),
  }));
}

function verifyCriticalModules() {
  const modules = ['better-sqlite3', 'sqlite-vec'];
  for (const mod of modules) {
    if (!existsSync(join(ROOT, 'node_modules', mod))) {
      console.error(`[memory-lite] Missing module: ${mod}`);
      return false;
    }
  }
  return true;
}

try {
  if (needsInstall()) {
    installDeps();
    if (!verifyCriticalModules()) {
      console.error('[memory-lite] Dependencies could not be installed.');
      process.exit(1);
    }
    console.error('[memory-lite] Dependencies installed successfully.');
  }
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
} catch (e) {
  console.error('[memory-lite] Setup failed:', e.message);
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(1);
}
