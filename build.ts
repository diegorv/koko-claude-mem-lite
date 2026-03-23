import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node' as const,
  format: 'esm' as const,
  target: 'node18',
  external: ['better-sqlite3', 'sqlite-vec', '@anthropic-ai/claude-agent-sdk'],
  sourcemap: false,
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
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
