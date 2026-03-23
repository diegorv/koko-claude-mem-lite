import { build } from 'esbuild';

const external = ['better-sqlite3', 'sqlite-vec', '@anthropic-ai/claude-agent-sdk'];

async function main() {
  // Hook entry point (CJS)
  await build({
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external,
    sourcemap: false,
    minify: false,
    entryPoints: ['src/hooks/hook.ts'],
    outfile: 'plugin/scripts/hook.cjs',
    banner: { js: '#!/usr/bin/env node' },
  });

  // Worker server (CJS — Express is CJS)
  await build({
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external,
    sourcemap: false,
    minify: false,
    entryPoints: ['src/worker/server.ts'],
    outfile: 'plugin/scripts/worker.cjs',
    banner: { js: '#!/usr/bin/env node' },
  });

  // MCP server (ESM — MCP SDK is ESM-only)
  await build({
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    external,
    sourcemap: false,
    minify: false,
    entryPoints: ['src/mcp/server.ts'],
    outfile: 'plugin/scripts/mcp-server.mjs',
    banner: { js: '#!/usr/bin/env node' },
  });

  console.log('Build complete.');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
