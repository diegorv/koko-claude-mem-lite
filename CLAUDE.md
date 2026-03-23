# Memory Lite Plugin

## Architecture

- **src/** - TypeScript source (hooks, worker, UI, DB, MCP)
- **plugin/** - Built output that gets installed by Claude Code
- **build.ts** - esbuild bundles `src/hooks/hook.ts` -> `plugin/scripts/hook.mjs`, `src/worker/server.ts` -> `plugin/scripts/worker.mjs`, `src/mcp/server.ts` -> `plugin/scripts/mcp-server.mjs`
- **vite** builds the Svelte UI -> `plugin/ui/`
- Native deps (`better-sqlite3`, `sqlite-vec`) are external (not bundled) and installed at runtime via `setup.mjs`

## Build & Deploy Workflow

**CRITICAL: Always run the full build before reinstalling the plugin.**

```bash
npm run build          # esbuild (backend) + vite (frontend)
npm run build:worker   # esbuild only (backend)
npm run build:ui       # vite only (frontend)
```

### Releasing a new version

1. `npm run build` — rebuilds everything into `plugin/`
2. `claude plugins uninstall memory-lite` — remove old version
3. `claude plugins install memory-lite@memory-lite-plugin` — install from marketplace
4. Restart Claude (close + reopen) — `SessionStart` hook triggers worker startup

### Verifying the install

```bash
# Check the cache has the new code
grep -c 'YOUR_UNIQUE_STRING' ~/.claude/plugins/cache/memory-lite-plugin/memory-lite/*/scripts/hook.mjs

# Check deps installed
ls ~/.claude/plugins/cache/memory-lite-plugin/memory-lite/*/node_modules/better-sqlite3

# Check worker health
curl -s http://localhost:37888/api/health
```

## Plugin Lifecycle (hooks)

The plugin uses Claude Code hooks defined in `plugin/hooks/hooks.json`:

### SessionStart (matcher: `*`)
Runs on ANY session start (startup, resume, clear, compact). Three hooks in order:
1. **setup.mjs** — installs `node_modules` if missing (npm install)
2. **hook.mjs start** — spawns worker as detached process if not already running
3. **hook.mjs context** — injects memory context into session

### Key lessons learned:
- **Matcher must be `*`** — using `startup|clear|compact` misses `resume` sessions, so the worker never starts on `claude --resume`
- **setup.mjs must run in SessionStart**, not just Setup hook — the Setup hook doesn't fire reliably on every session
- **Dependencies must be installed before worker spawn** — `hook.mjs start` also checks for `better-sqlite3` and runs `npm install` if missing (belt and suspenders with setup.mjs)
- **`claude plugins install` wipes the cache** — every reinstall deletes `node_modules`, so the setup hook MUST handle fresh installs
- **Use `process.execPath` not `'node'`** — ensures the same Node binary is used for the worker
- **Health check with polling after spawn** — don't blindly `sleep(2000)`, poll `/api/health` with timeout (up to 10s)
- **Never swallow spawn errors silently** — always `console.error` on failure, otherwise debugging is impossible

## Worker

- Runs on port 37888 (configurable via `WORKER_PORT` setting)
- Spawned as detached process (`child.unref()`) so it outlives the hook
- Serves both the API and the static UI from `plugin/ui/`
- Uses `better-sqlite3` + `sqlite-vec` for storage and vector search

## Common Gotchas

1. **"Worker not starting"** — Most likely `node_modules` missing in the cache dir. Check with `ls ~/.claude/plugins/cache/memory-lite-plugin/memory-lite/*/node_modules/`
2. **"Changes not showing"** — Did you run `npm run build`? The plugin dir has compiled bundles, not live source.
3. **"Old code still running"** — Kill the worker: `lsof -ti :37888 | xargs kill`, then restart Claude
4. **"Feed items missing data"** — If you add new fields to feed queries (e.g. JOINs), both `npm run build` (backend) AND `npm run build:ui` (frontend) need to run
5. **Testing locally without reinstalling** — You can run `CLAUDE_PLUGIN_ROOT=./plugin node plugin/scripts/hook.mjs start` to test the hook directly
