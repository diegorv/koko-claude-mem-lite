# memory-lite

[![Release](https://github.com/diegorv/koko-claude-mem-lite/actions/workflows/release.yml/badge.svg)](https://github.com/diegorv/koko-claude-mem-lite/actions/workflows/release.yml)

> [!CAUTION]
> **EARLY STAGE SOFTWARE — DO NOT USE FOR ANYTHING IMPORTANT**
>
> This project is in a very early stage of development and is **not recommended for use by anyone**.
> There is a real risk of **data loss, unexpected behavior, and breaking changes** without notice.
> Do not rely on this software to preserve any important context or memory data.
>
> Expect breaking changes, missing features, and rough edges.

> [!WARNING]
> **We are not accepting pull requests, issues, or external contributions at this time.**

> [!NOTE]
> **Looking for a production-ready memory plugin? Use [claude-mem](https://github.com/thedotmack/claude-mem) instead.**
>
> memory-lite was inspired by [claude-mem](https://github.com/thedotmack/claude-mem) — a mature, well-tested memory plugin for Claude Code. No code was copied or derived from that project; this is an independent reimplementation exploring different architectural ideas (multi-turn observer, Svelte dashboard, MCP progressive disclosure, etc.).
>
> If you just want memory that works today, **claude-mem is the right choice**. memory-lite is an experimental project and not recommended for regular use.

A privacy-first memory plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Automatically captures what happens during your coding sessions, compresses it with AI, and re-injects the context when you start a new session — so Claude remembers what you were working on.

## How It Works

memory-lite hooks into Claude Code's plugin lifecycle to silently observe your sessions:

```
┌─────────────┐     ┌──────────┐     ┌──────────┐     ┌─────────────┐
│ SessionStart│────▶│  Inject  │     │  Store   │     │  Generate   │
│   (hook)    │     │ Context  │     │Observation│     │  Summary    │
└─────────────┘     └──────────┘     └──────────┘     └─────────────┘
                         ▲                ▲                  ▲
                         │                │                  │
                    On startup      Every tool use     On session end
                         │                │                  │
                    Reads past      Multi-turn AI      AI summarizes
                    summaries +     observer extracts  the full session
                    observations    structured data    into 5 fields
```

1. **Session starts** → The plugin fetches recent summaries and observations from past sessions and injects them as context, giving Claude memory of previous work.
2. **Every tool use** → The tool name, input, and output are sent to a persistent multi-turn observer conversation (or a single-turn fallback), which extracts a structured observation (type, title, facts, narrative, files read/modified).
3. **Session ends** → The last assistant message is summarized into 5 fields: what was requested, investigated, learned, completed, and what's next.

All data is stored locally in a SQLite database at `~/.memory-lite/data.db`. AI extraction uses Claude Code's own authentication (subscription billing via the Agent SDK) — **no separate API key is needed**.

## Features

- **Automatic context injection** — Past session summaries and recent observations are injected at the start of every new session
- **Multi-turn AI observer** — A persistent conversation with Claude Sonnet tracks tool uses across the session for better context, with SQLite-backed durable queue for crash recovery
- **Session summaries** — End-of-session summaries capture what was done and what's next
- **MCP search tools** — Three progressive-disclosure tools (`memory_search`, `memory_timeline`, `memory_get`) exposed as an MCP server for Claude to query its own memory
- **AI-powered cleanup** — Review and bulk-delete stale or low-signal observations via SSE-streamed AI analysis
- **Full-text search** — FTS5-powered search across all observations
- **Semantic search** — Optional vector search via Ollama + sqlite-vec for similarity-based queries
- **Privacy controls** — Wrap sensitive content in `<private>` tags to exclude it from storage
- **Deduplication** — Content-hash-based dedup within a 30-second window prevents duplicate observations
- **Web dashboard** — Browse sessions, observations, and summaries at `http://localhost:37888`
- **Configurable settings** — Live-editable settings via the dashboard or API
- **Graceful degradation** — If the worker is down, AI is unavailable, or Ollama isn't running, everything degrades silently without breaking Claude Code

## Installation

### Prerequisites

- Node.js 20+
- Claude Code CLI (v2.x+) with an active subscription

### Install as a Claude Code Plugin

```bash
# Clone the repository
git clone <repo-url> memory-lite-plugin
cd memory-lite-plugin

# Install dependencies
npm install

# Build the plugin (worker + hooks + dashboard UI)
npm run build

# Register as a local marketplace and install
claude plugin marketplace add .
claude plugin install memory-lite
```

Restart Claude Code. The plugin will be active in all sessions.

### Verify Installation

```bash
# Check if the worker is running
curl http://localhost:37888/api/health
# → {"ok":true}

# Open the dashboard
open http://localhost:37888
```

## Architecture

### Components

```
memory-lite-plugin/
├── src/
│   ├── hooks/
│   │   ├── hook.ts          # Main entry point for all Claude Code hooks
│   │   ├── adapter.ts       # Normalizes hook stdin/stdout contract
│   │   └── stdin.ts         # JSON stdin reader
│   ├── worker/
│   │   ├── server.ts        # Hono server, PID management, shutdown
│   │   ├── routes.ts        # API endpoints (core + dashboard + cleanup)
│   │   ├── observer.ts      # Multi-turn ObserverSession with durable queue
│   │   ├── summarizer.ts    # Claude API calls for extraction & summarization
│   │   └── formatter.ts     # Formats search/timeline results for MCP
│   ├── mcp/
│   │   └── server.ts        # MCP server exposing memory_search/timeline/get tools
│   ├── db/
│   │   ├── database.ts      # SQLite init, schema, pragma config
│   │   ├── queries.ts       # Query builders for sessions, observations, summaries
│   │   └── pending-store.ts # Durable queue for multi-turn observer messages
│   ├── context/
│   │   └── generator.ts     # Builds Markdown context for session injection
│   ├── embeddings/
│   │   └── embeddings.ts    # Ollama + sqlite-vec integration
│   └── utils/
│       ├── paths.ts         # Data directory and file path helpers
│       ├── settings.ts      # Configuration with env var overrides
│       ├── privacy.ts       # <private> and <memory-lite-context> tag stripping
│       ├── hash.ts          # SHA256 content hashing for deduplication
│       └── logger.ts        # Structured file logger (writes to ~/.memory-lite/worker.log)
│   └── ui/                  # Svelte 5 dashboard (Vite-built SPA)
│       ├── App.svelte
│       ├── main.ts
│       ├── api.ts
│       └── components/
│           ├── Header.svelte
│           ├── StatsBar.svelte
│           ├── FeedView.svelte
│           ├── FeedItem.svelte
│           ├── SessionsView.svelte
│           ├── SearchView.svelte
│           ├── ContextView.svelte
│           └── SettingsView.svelte
├── plugin/                   # Built artifacts (what Claude Code loads)
│   ├── .claude-plugin/
│   │   └── plugin.json
│   ├── hooks/
│   │   └── hooks.json
│   ├── scripts/
│   │   ├── setup.mjs         # Installs native deps (better-sqlite3, sqlite-vec)
│   │   ├── hook.mjs          # Bundled hook entry point
│   │   ├── worker.mjs        # Bundled Hono worker
│   │   └── mcp-server.mjs    # Bundled MCP server
│   └── ui/                   # Built dashboard static files
└── .claude-plugin/
    └── marketplace.json      # Local marketplace manifest
```

### Hook Lifecycle

| Hook | Event | Action | Timeout |
|------|-------|--------|---------|
| `Setup` | Plugin setup | Installs native dependencies (`better-sqlite3`, `sqlite-vec`) | 300s |
| `SessionStart` (setup) | Any session start | Installs deps if missing | 300s |
| `SessionStart` (start) | Any session start | Spawns worker daemon if not already running | 60s |
| `SessionStart` (context) | Any session start | Injects memory context into session | 30s |
| `UserPromptSubmit` | User sends a message | Creates/resumes session, stores prompt | 30s |
| `PostToolUse` | Any tool finishes | Multi-turn observer (or single-turn fallback) extracts structured observation | 120s |
| `Stop` | Claude stops responding | AI generates session summary | 60s |
| `SessionEnd` | Session ends | Marks session as completed | 15s |

### Worker Process

The worker is a background HTTP server (`127.0.0.1:37888`, built with [Hono](https://hono.dev)) that:

- Manages the SQLite database via `better-sqlite3`
- Hosts multi-turn `ObserverSession` instances, one per active Claude Code session
- Handles AI extraction calls (Claude Sonnet via Anthropic Agent SDK)
- Serves the dashboard UI static files
- Auto-spawns on first hook call if not running
- Writes its PID (as structured JSON `{ pid, port, startedAt }`) to `~/.memory-lite/worker.pid`
- Shuts down gracefully on SIGTERM/SIGINT/SIGHUP
- Logs to `~/.memory-lite/worker.log` (structured file logger)

#### Zombie Prevention & Resource Management

The worker has several safety mechanisms to prevent zombie processes and runaway CPU usage:

- **SDK subprocess cleanup** — Each `ObserverSession` holds a reference to the Claude Agent SDK `Query` object and calls `conversation.close()` on destroy. The `AbortController` is passed to the SDK so `abort()` kills the underlying CLI subprocess immediately.
- **SDK idle timeout** — If the SDK `for await` loop receives no messages for 5 minutes, the query is force-aborted to prevent hung subprocesses.
- **Stale session reaper** — A background timer (every 60s) checks all active observer sessions. Any session idle for more than 30 minutes is automatically destroyed — this is a safety net for when the `SessionEnd` hook doesn't fire.
- **Idle auto-shutdown** — If there are zero active sessions and no API requests for 30 minutes, the worker shuts itself down. It will be re-spawned automatically on the next Claude Code session start.
- **Duplicate worker detection** — On startup, the worker checks the PID file and health endpoint to prevent multiple instances. Stale PID files from crashed workers are cleaned up automatically.

#### Debugging

```bash
# Check worker health
curl -s http://localhost:37888/api/health

# View active observer sessions
curl -s http://localhost:37888/api/debug/sessions

# Check logs
cat ~/.memory-lite/worker.log

# Kill a stuck worker manually
lsof -ti :37888 | xargs kill
```

### Multi-turn Observer

Instead of a separate AI call per tool use, memory-lite maintains a persistent `ObserverSession` for each active Claude Code session. The observer:

- Runs a multi-turn conversation with Claude Sonnet as a specialized "observer" role
- Receives each tool use as a message and responds with structured XML observations
- Uses a SQLite-backed durable queue (`pending_messages` table) so messages survive worker crashes
- Stores the Agent SDK session ID so conversations can be resumed if the worker restarts
- Falls back to single-turn extraction if no observer session is available
- Properly cleans up SDK subprocesses on session destroy (via `Query.close()` + `AbortController`)
- Auto-destroyed after 30 minutes of inactivity by the stale session reaper

### Database Schema

**sessions** — One per Claude Code session
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `content_session_id` | TEXT | Claude Code's session identifier |
| `project` | TEXT | Project folder name |
| `user_prompt` | TEXT | Initial user prompt (privacy-stripped) |
| `memory_session_id` | TEXT | Agent SDK session ID for observer resume |
| `status` | TEXT | `active` or `completed` |
| `created_at` | TEXT | ISO 8601 timestamp |
| `created_at_epoch` | INTEGER | Unix epoch ms |

**observations** — Structured data extracted from each tool use
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `session_id` | INTEGER | FK to sessions |
| `project` | TEXT | Project folder name |
| `type` | TEXT | `bugfix`, `feature`, `refactor`, `discovery`, `decision`, or `change` |
| `title` | TEXT | Short description (5-10 words) |
| `facts` | TEXT | JSON array of specific facts |
| `narrative` | TEXT | 2-3 sentence summary |
| `files_read` | TEXT | JSON array of file paths |
| `files_modified` | TEXT | JSON array of file paths |
| `content_hash` | TEXT | SHA256 hash for deduplication |
| `created_at` | TEXT | ISO 8601 timestamp |
| `created_at_epoch` | INTEGER | Unix epoch ms |

**summaries** — One or more per session, generated at session end
| Column | Type | Description |
|--------|------|-------------|
| `session_id` | INTEGER | FK to sessions |
| `project` | TEXT | Project folder name |
| `request` | TEXT | What the user originally asked |
| `investigated` | TEXT | What was explored |
| `learned` | TEXT | Key findings |
| `completed` | TEXT | What was actually done |
| `next_steps` | TEXT | What remains |
| `created_at_epoch` | INTEGER | Unix epoch ms |

**pending_messages** — Durable queue for multi-turn observer
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `content_session_id` | TEXT | Owning session |
| `kind` | TEXT | `observation` or `summary` |
| `prompt` | TEXT | Message content to send to the observer |
| `status` | TEXT | `pending` or `processing` |
| `created_at_epoch` | INTEGER | Unix epoch ms |

**observations_fts** — FTS5 virtual table indexing title, narrative, and facts for full-text search.

**observations_vec** — (Optional) sqlite-vec virtual table for 1024-dimensional embeddings, enabling semantic similarity search.

## Dashboard

The web dashboard is available at `http://localhost:37888` when the worker is running.

### Views

- **Feed** — Reverse-chronological stream of observations and summaries across all projects. Each observation card shows its type badge, title, narrative, extracted facts, and files read/modified.
- **Sessions** — Browse all sessions with observation counts and inline summaries. Click a session to see its full observation timeline.
- **Search** — Full-text search across all observations using SQLite FTS5.
- **Context** — Preview the exact memory context that will be injected into the next session, broken down by summaries and observations.
- **Settings** — View and edit plugin configuration live (changes saved to `~/.memory-lite/settings.json`).

### Stats Bar

- Total sessions, observations, summaries, and projects
- Observation type breakdown (bugfix, feature, refactor, discovery, decision, change)
- 7-day activity sparkline
- Worker uptime

## MCP Tools

memory-lite exposes an MCP server with three progressive-disclosure tools for Claude to search its own memory:

| Tool | Description |
|------|-------------|
| `memory_search` | Step 1: FTS5 search returning a compact index of matching observations (IDs + snippets) |
| `memory_timeline` | Step 2: Get chronological context around a specific observation ID |
| `memory_get` | Step 3: Fetch full details for a specific set of observation IDs |

The progressive design keeps token usage low — start with a search, drill into the timeline, then fetch full details only for what's relevant.

## Context Injection

At the start of each session, memory-lite injects a Markdown context block containing:

1. **Recent summaries** (last 3 by default) — What was done, learned, and what's next
2. **Recent activity table** (last 50 observations) — Time, type, title, and files
3. **Full details** (last 5 observations) — Complete facts, narrative, and file lists

This context is wrapped in `<memory-lite-context>` tags, which are automatically stripped from any data stored back — preventing recursive storage.

## AI Cleanup

The dashboard includes an AI-powered cleanup tool that helps keep memory lean and high-signal:

1. Open the dashboard and navigate to a project's cleanup view
2. The worker streams items (via SSE) to the UI as "pending", then triggers Claude Sonnet to review each one
3. Claude recommends `KEEP` or `DELETE` with a reason, focusing on deleting low-value entries (routine edits, ephemeral build status, self-referential noise)
4. Review the recommendations and apply selected deletions in bulk

## Privacy

- **`<private>` tags** — Wrap any content in `<private>...</private>` in your prompts to exclude it from storage. Content inside these tags is stripped at the hook layer before reaching the worker or database.
- **Entirely private prompts** — If a prompt is entirely wrapped in `<private>` tags, the session is skipped entirely.
- **Local storage** — All data stays in `~/.memory-lite/data.db` on your machine.
- **No telemetry** — The only network calls are to the Anthropic API for observation extraction and summarization, using your existing Claude Code subscription.

## Configuration

Settings are stored in `~/.memory-lite/settings.json`:

```json
{
  "WORKER_PORT": 37888,
  "OBSERVATION_COUNT": 50,
  "FULL_OBSERVATION_COUNT": 5,
  "SUMMARY_COUNT": 3,
  "OLLAMA_URL": "http://localhost:11434",
  "OLLAMA_MODEL": "bge-m3"
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `WORKER_PORT` | `37888` | Port for the worker HTTP server |
| `OBSERVATION_COUNT` | `50` | Number of recent observations to include in context |
| `FULL_OBSERVATION_COUNT` | `5` | Number of observations with full detail in context |
| `SUMMARY_COUNT` | `3` | Number of recent summaries to include in context |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL for embeddings |
| `OLLAMA_MODEL` | `bge-m3` | Ollama model for generating embeddings |

All settings can be overridden via environment variables with the `MEMORY_LITE_` prefix (e.g., `MEMORY_LITE_WORKER_PORT=9999`). Settings can also be edited live via the dashboard Settings view or the `PUT /api/settings` endpoint.

## Semantic Search (Optional)

For similarity-based search beyond keyword matching:

1. Install [Ollama](https://ollama.ai) and pull the embedding model:
   ```bash
   ollama pull bge-m3
   ```

2. Install the [sqlite-vec](https://github.com/asg017/sqlite-vec) extension (e.g., via Homebrew on macOS):
   ```bash
   brew install asg017/sqlite-vec/sqlite-vec
   ```

3. Restart the worker. Embeddings will be generated automatically for new observations, and semantic search will be available via the API:
   ```
   GET /api/search?q=authentication+flow&mode=semantic
   ```

If Ollama or sqlite-vec aren't available, everything continues to work — only semantic search is disabled.

## API Reference

### Core Endpoints (used by hooks)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Liveness check → `{ ok: true }` (responds as soon as server is up) |
| `GET` | `/api/readiness` | Readiness check → `{ ok: true }` only after DB is fully initialized |
| `GET` | `/api/debug/sessions` | List active observer sessions with idle times, uptime, PID, and memory usage |
| `GET` | `/api/context?project=` | Get context for session injection |
| `POST` | `/api/sessions` | Create or resume a session |
| `POST` | `/api/observations` | Store a tool-use observation (AI-extracted) |
| `POST` | `/api/summarize` | Generate end-of-session summary |
| `POST` | `/api/sessions/complete` | Mark session as completed |
| `GET` | `/api/search?q=&mode=fts` | Full-text or semantic search |

### MCP / Progressive Disclosure Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/search/index?q=` | Compact FTS5 index (IDs + snippets), used by `memory_search` MCP tool |
| `GET` | `/api/timeline?anchor=` | Observations around a given ID, used by `memory_timeline` |
| `POST` | `/api/observations/batch` | Full details for a set of IDs, used by `memory_get` |

### Dashboard Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard/stats` | Aggregate stats, type breakdown, daily activity |
| `GET` | `/api/dashboard/projects` | List projects with session counts |
| `GET` | `/api/dashboard/sessions` | Paginated sessions with observation counts |
| `GET` | `/api/dashboard/sessions/:id/observations` | Observations for a specific session |
| `GET` | `/api/dashboard/feed` | Mixed feed of observations and summaries |
| `GET` | `/api/dashboard/context-preview?project=` | Preview the context that would be injected |

### Settings Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings` | Get current settings |
| `PUT` | `/api/settings` | Update settings (persisted to disk) |

### Delete Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `DELETE` | `/api/observations/:id` | Delete a single observation |
| `DELETE` | `/api/summaries/:id` | Delete a single summary |
| `DELETE` | `/api/sessions/:id` | Delete a session and all its data (CASCADE) |

### AI Cleanup Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/cleanup/review` | SSE stream: AI reviews observations/summaries for deletion candidates |
| `POST` | `/api/cleanup/apply` | Apply a set of deletions from a cleanup review |

## Development

```bash
# Install dependencies
npm install

# Build worker + hooks (esbuild)
npm run build:worker

# Build dashboard UI (Vite + Svelte)
npm run build:ui

# Build everything
npm run build

# Dev mode for UI (with hot reload, proxies API to worker)
npm run dev:ui

# Start/stop worker manually
npm run worker:start
npm run worker:stop
```

### Releasing a new version

```bash
npm run build
claude plugins uninstall memory-lite
claude plugins install memory-lite@memory-lite-plugin
# Restart Claude Code (close + reopen)
```

## Tech Stack

- **Runtime**: Node.js 20+
- **Database**: SQLite (via `better-sqlite3`) with WAL mode, FTS5, and optional sqlite-vec
- **Worker**: [Hono](https://hono.dev) + `@hono/node-server`
- **AI**: Claude Sonnet (`claude-sonnet-4-6`) via [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) (uses Claude Code's own subscription — no API key needed)
- **Embeddings**: Ollama (optional)
- **Dashboard**: Svelte 5 + Vite
- **Build**: esbuild (worker/hooks/MCP) + Vite (UI)

## License

MIT
