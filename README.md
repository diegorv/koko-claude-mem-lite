# memory-lite

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
                    Reads past      AI extracts        AI summarizes
                    summaries +     structured data    the full session
                    observations    from tool I/O      into 5 fields
```

1. **Session starts** → The plugin fetches recent summaries and observations from past sessions and injects them as context, giving Claude memory of previous work.
2. **Every tool use** → The tool name, input, and output are sent to Claude Sonnet via the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk), which extracts a structured observation (type, title, facts, narrative, files read/modified).
3. **Session ends** → The last assistant message is summarized into 5 fields: what was requested, investigated, learned, completed, and what's next.

All data is stored locally in a SQLite database at `~/.memory-lite/data.db`. AI extraction uses Claude Code's own authentication (subscription billing via the Agent SDK) — **no separate API key is needed**.

## Features

- **Automatic context injection** — Past session summaries and recent observations are injected at the start of every new session
- **AI-powered observation extraction** — Each tool use is analyzed by Claude Sonnet to extract structured facts, narratives, and file references
- **Session summaries** — End-of-session summaries capture what was done and what's next
- **Full-text search** — FTS5-powered search across all observations
- **Semantic search** — Optional vector search via Ollama + sqlite-vec for similarity-based queries
- **Privacy controls** — Wrap sensitive content in `<private>` tags to exclude it from storage
- **Deduplication** — Content-hash-based dedup within a 30-second window prevents duplicate observations
- **Web dashboard** — Browse sessions, observations, and summaries at `http://localhost:37888`
- **Graceful degradation** — If the worker is down, AI is unavailable, or Ollama isn't running, everything degrades silently without breaking Claude Code

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime
- Claude Code CLI (v2.x+) with an active subscription

### Install as a Claude Code Plugin

```bash
# Clone the repository
git clone <repo-url> memory-lite-plugin
cd memory-lite-plugin

# Install dependencies
bun install

# Build the plugin (worker + hooks + dashboard UI)
bun run build

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
│   │   ├── server.ts        # Express server, PID management, shutdown
│   │   ├── routes.ts        # API endpoints (core + dashboard)
│   │   └── summarizer.ts    # Claude API calls for extraction & summarization
│   ├── db/
│   │   ├── database.ts      # SQLite init, schema, pragma config
│   │   └── queries.ts       # Query builders for sessions, observations, summaries
│   ├── context/
│   │   └── generator.ts     # Builds Markdown context for session injection
│   ├── embeddings/
│   │   └── embeddings.ts    # Ollama + sqlite-vec integration
│   ├── utils/
│   │   ├── paths.ts         # Data directory and file path helpers
│   │   ├── settings.ts      # Configuration with env var overrides
│   │   ├── privacy.ts       # <private> and <memory-lite-context> tag stripping
│   │   └── hash.ts          # SHA256 content hashing for deduplication
│   └── ui/                  # Svelte 5 dashboard (Vite-built SPA)
│       ├── App.svelte
│       ├── api.ts
│       └── components/
├── plugin/                   # Built artifacts (what Claude Code loads)
│   ├── .claude-plugin/
│   │   └── plugin.json
│   ├── hooks/
│   │   └── hooks.json
│   ├── scripts/
│   │   ├── hook.js           # Bundled hook entry point
│   │   └── worker.js         # Bundled Express worker
│   └── ui/                   # Built dashboard static files
└── .claude-plugin/
    └── marketplace.json      # Local marketplace manifest
```

### Hook Lifecycle

| Hook | Event | Action | Timeout |
|------|-------|--------|---------|
| `SessionStart` | New session or clear/compact | Injects context from past sessions | 30s |
| `UserPromptSubmit` | User sends a message | Creates/resumes session, stores prompt | 30s |
| `PostToolUse` | Any tool finishes | AI extracts structured observation | 120s |
| `Stop` | Claude stops responding | AI generates session summary | 60s |
| `SessionEnd` | Session ends | Marks session as completed | 15s |

### Worker Process

The worker is a background Express server (`127.0.0.1:37888`) that:

- Manages the SQLite database
- Handles AI extraction calls (Claude Sonnet via Anthropic SDK)
- Serves the dashboard UI
- Auto-spawns on first hook call if not running
- Writes its PID to `~/.memory-lite/worker.pid`
- Shuts down gracefully on SIGTERM/SIGINT

### Database Schema

**sessions** — One per Claude Code session
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `content_session_id` | TEXT | Claude Code's session identifier |
| `project` | TEXT | Project folder name |
| `user_prompt` | TEXT | Initial user prompt (privacy-stripped) |
| `status` | TEXT | `active` or `completed` |
| `created_at` | TEXT | ISO 8601 timestamp |

**observations** — Structured data extracted from each tool use
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `session_id` | INTEGER | FK to sessions |
| `type` | TEXT | `discovery`, `implementation`, `debugging`, `architecture`, or `raw` |
| `title` | TEXT | Short description (5-10 words) |
| `facts` | TEXT | JSON array of specific facts |
| `narrative` | TEXT | 2-3 sentence summary |
| `files_read` | TEXT | JSON array of file paths |
| `files_modified` | TEXT | JSON array of file paths |
| `content_hash` | TEXT | SHA256 hash for deduplication |

**summaries** — One per session, generated at session end
| Column | Type | Description |
|--------|------|-------------|
| `session_id` | INTEGER | FK to sessions (unique) |
| `request` | TEXT | What the user originally asked |
| `investigated` | TEXT | What was explored |
| `learned` | TEXT | Key findings |
| `completed` | TEXT | What was actually done |
| `next_steps` | TEXT | What remains |

**observations_fts** — FTS5 virtual table indexing title, narrative, and facts for full-text search.

**observations_vec** — (Optional) sqlite-vec virtual table for 1024-dimensional embeddings, enabling semantic similarity search.

## Dashboard

The web dashboard is available at `http://localhost:37888` when the worker is running.

### Views

- **Feed** — Reverse-chronological stream of observations and summaries across all projects. Each observation card shows its type badge, title, narrative, extracted facts, and files read/modified. Toggle between narrative and facts view per card.
- **Sessions** — Browse all sessions with observation counts and inline summaries. Click a session to see its full observation timeline.
- **Search** — Full-text search across all observations using SQLite FTS5.

### Stats Bar

- Total sessions, observations, summaries, and projects
- Observation type breakdown (discovery, implementation, debugging, architecture)
- 7-day activity sparkline
- Worker uptime

## Context Injection

At the start of each session, memory-lite injects a Markdown context block containing:

1. **Recent summaries** (last 3 by default) — What was done, learned, and what's next
2. **Recent activity table** (last 50 observations) — Time, type, title, and files
3. **Full details** (last 5 observations) — Complete facts, narrative, and file lists

This context is wrapped in `<memory-lite-context>` tags, which are automatically stripped from any data stored back — preventing recursive storage.

## Privacy

- **`<private>` tags** — Wrap any content in `<private>...</private>` in your prompts to exclude it from storage. Content inside these tags is stripped at the hook layer before reaching the worker or database.
- **Entirely private prompts** — If a prompt is entirely wrapped in `<private>` tags, the session is skipped entirely.
- **Local storage** — All data stays in `~/.memory-lite/data.db` on your machine.
- **No telemetry** — The only network calls are to the Anthropic API for observation extraction and summarization, using your existing API key.

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

All settings can be overridden via environment variables with the `MEMORY_LITE_` prefix (e.g., `MEMORY_LITE_WORKER_PORT=9999`).

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
| `GET` | `/api/health` | Health check → `{ ok: true }` |
| `GET` | `/api/context?project=` | Get context for session injection |
| `POST` | `/api/sessions` | Create or resume a session |
| `POST` | `/api/observations` | Store a tool-use observation (AI-extracted) |
| `POST` | `/api/summarize` | Generate end-of-session summary |
| `POST` | `/api/sessions/complete` | Mark session as completed |
| `GET` | `/api/search?q=&mode=fts` | Full-text or semantic search |

### Dashboard Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard/stats` | Aggregate stats, type breakdown, daily activity |
| `GET` | `/api/dashboard/projects` | List projects with session counts |
| `GET` | `/api/dashboard/sessions` | Paginated sessions with observation counts |
| `GET` | `/api/dashboard/sessions/:id/observations` | Observations for a specific session |
| `GET` | `/api/dashboard/feed` | Mixed feed of observations and summaries |

## Development

```bash
# Install dependencies
bun install

# Build worker + hooks (esbuild)
bun run build:worker

# Build dashboard UI (Vite + Svelte)
bun run build:ui

# Build everything
bun run build

# Dev mode for UI (with hot reload, proxies API to worker)
bun run dev:ui

# Start/stop worker manually
bun run worker:start
bun run worker:stop
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Database**: SQLite (via `bun:sqlite`) with WAL mode, FTS5, and optional sqlite-vec
- **Worker**: Express.js
- **AI**: Claude Sonnet via [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) (uses Claude Code's own subscription — no API key needed)
- **Embeddings**: Ollama (optional)
- **Dashboard**: Svelte 5 + Vite
- **Build**: esbuild (worker/hooks) + Vite (UI)

## License

MIT
