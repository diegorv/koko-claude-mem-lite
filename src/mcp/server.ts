/**
 * memory-lite MCP Search Server
 *
 * Thin wrapper that delegates to the Worker HTTP API at localhost:37888.
 * Provides 3 tools for progressive disclosure memory search.
 */

// Redirect console.log to stderr to protect MCP stdio protocol
console.log = (...args: any[]) => console.error(...args);

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getSetting } from '../utils/settings.js';

const WORKER_BASE = () => `http://127.0.0.1:${getSetting('WORKER_PORT')}`;

async function callWorker(
  path: string,
  options: { method?: string; body?: any } = {}
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const url = `${WORKER_BASE()}${path}`;
    const fetchOpts: RequestInit = { method: options.method || 'GET' };
    if (options.body) {
      fetchOpts.method = 'POST';
      fetchOpts.headers = { 'Content-Type': 'application/json' };
      fetchOpts.body = JSON.stringify(options.body);
    }

    const resp = await fetch(url, fetchOpts);
    if (!resp.ok) {
      const text = await resp.text();
      return { content: [{ type: 'text', text: `Error (${resp.status}): ${text}` }], isError: true };
    }

    const data = await resp.json() as any;
    // Worker returns { content: [{ type, text }] } format
    if (data.content) return data;
    // Fallback: wrap raw JSON
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Worker unavailable: ${msg}. Ensure memory-lite worker is running.` }],
      isError: true,
    };
  }
}

const server = new Server(
  { name: 'memory-lite', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'memory_search',
      description:
        'Step 1: Search memory observations. Returns a compact index with IDs and estimated token counts (~50-100 tokens per result). Always start here, then use memory_timeline or memory_get to drill down.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query (FTS5 syntax supported)' },
          project: { type: 'string', description: 'Filter by project name' },
          type: { type: 'string', description: 'Filter by observation type: discovery, implementation, debugging, architecture, raw' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'memory_timeline',
      description:
        'Step 2: Get chronological context around a specific observation. Shows what happened before and after. Use an ID from memory_search results.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          anchor: { type: 'number', description: 'Observation ID to center timeline on' },
          depth_before: { type: 'number', description: 'Number of observations before anchor (default 5)' },
          depth_after: { type: 'number', description: 'Number of observations after anchor (default 5)' },
          project: { type: 'string', description: 'Filter by project name' },
        },
        required: ['anchor'],
      },
    },
    {
      name: 'memory_get',
      description:
        'Step 3: Fetch full details for specific observation IDs. Only use this for IDs you actually need — each observation is ~500-1000 tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'Array of observation IDs to fetch',
          },
        },
        required: ['ids'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'memory_search': {
      const params = new URLSearchParams();
      params.set('q', (args as any).query);
      if ((args as any).project) params.set('project', (args as any).project);
      if ((args as any).type) params.set('type', (args as any).type);
      if ((args as any).limit) params.set('limit', String((args as any).limit));
      return callWorker(`/api/search/index?${params}`);
    }

    case 'memory_timeline': {
      const params = new URLSearchParams();
      params.set('anchor', String((args as any).anchor));
      if ((args as any).depth_before) params.set('depth_before', String((args as any).depth_before));
      if ((args as any).depth_after) params.set('depth_after', String((args as any).depth_after));
      if ((args as any).project) params.set('project', (args as any).project);
      return callWorker(`/api/timeline?${params}`);
    }

    case 'memory_get': {
      return callWorker('/api/observations/batch', { body: { ids: (args as any).ids } });
    }

    default:
      return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[memory-lite-mcp] Server started on stdio');
}

main().catch((err) => {
  console.error('[memory-lite-mcp] Fatal:', err);
  process.exit(1);
});
