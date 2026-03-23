import { build } from 'esbuild';

const external = ['better-sqlite3', 'sqlite-vec', '@anthropic-ai/claude-agent-sdk'];

const shared = {
  bundle: true,
  platform: 'node' as const,
  format: 'esm' as const,
  target: 'node18',
  external,
  sourcemap: false,
  minify: false,
  banner: { js: '#!/usr/bin/env node\nimport{createRequire}from"module";import{fileURLToPath as __f}from"url";import{dirname as __d}from"path";const require=createRequire(import.meta.url);const __filename=__f(import.meta.url);const __dirname=__d(__filename);' },
};

async function main() {
  await build({
    ...shared,
    entryPoints: ['src/hooks/hook.ts'],
    outfile: 'plugin/scripts/hook.mjs',
  });

  await build({
    ...shared,
    entryPoints: ['src/worker/server.ts'],
    outfile: 'plugin/scripts/worker.mjs',
  });

  await build({
    ...shared,
    entryPoints: ['src/mcp/server.ts'],
    outfile: 'plugin/scripts/mcp-server.mjs',
  });

  console.log('Build complete.');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
