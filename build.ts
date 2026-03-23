import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node' as const,
  format: 'esm' as const,
  target: 'node18',
  external: ['better-sqlite3', 'sqlite-vec', '@anthropic-ai/claude-agent-sdk'],
  sourcemap: false,
  minify: false,
};

async function main() {
  // Hook entry point
  await build({
    ...shared,
    entryPoints: ['src/hooks/hook.ts'],
    outfile: 'plugin/scripts/hook.js',
    banner: { js: '#!/usr/bin/env node' },
  });

  // Worker server
  await build({
    ...shared,
    entryPoints: ['src/worker/server.ts'],
    outfile: 'plugin/scripts/worker.js',
    banner: { js: '#!/usr/bin/env node' },
  });

  // MCP server (bundles MCP SDK for self-contained plugin)
  await build({
    ...shared,
    entryPoints: ['src/mcp/server.ts'],
    outfile: 'plugin/scripts/mcp-server.js',
    banner: { js: '#!/usr/bin/env node' },
  });

  console.log('Build complete: plugin/scripts/hook.js, plugin/scripts/worker.js, plugin/scripts/mcp-server.js');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
