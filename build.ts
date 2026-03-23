import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node' as const,
  format: 'esm' as const,
  target: 'node18',
  external: ['bun:sqlite'],
  sourcemap: false,
  minify: false,
};

async function main() {
  // Hook entry point
  await build({
    ...shared,
    entryPoints: ['src/hooks/hook.ts'],
    outfile: 'plugin/scripts/hook.js',
    banner: { js: '#!/usr/bin/env bun' },
  });

  // Worker server
  await build({
    ...shared,
    entryPoints: ['src/worker/server.ts'],
    outfile: 'plugin/scripts/worker.js',
    banner: { js: '#!/usr/bin/env bun' },
  });

  console.log('Build complete: plugin/scripts/hook.js, plugin/scripts/worker.js');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
