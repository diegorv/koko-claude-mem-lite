const BASE = '';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface Stats {
  sessions: number;
  activeSessions: number;
  observations: number;
  summaries: number;
  projects: number;
  pendingMessages: number;
  activeObservers: number;
  types: { type: string; count: number }[];
  daily: { day: string; count: number }[];
  uptime: number;
}

export interface Project {
  project: string;
  session_count: number;
  last_active: string;
}

export interface Session {
  id: number;
  content_session_id: string;
  project: string;
  user_prompt: string | null;
  status: string;
  created_at: string;
  created_at_epoch: number;
  observation_count: number;
  summary: string | null;
}

export interface Observation {
  id: number;
  session_id: number;
  project: string;
  type: string;
  title: string | null;
  facts: string | null;
  narrative: string | null;
  files_read: string | null;
  files_modified: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface FeedItem {
  id: number;
  session_id: number;
  content_session_id?: string;
  project: string;
  created_at: string;
  created_at_epoch: number;
  item_type: 'observation' | 'summary';
  // observation fields
  type?: string;
  title?: string | null;
  facts?: string | null;
  narrative?: string | null;
  files_read?: string | null;
  files_modified?: string | null;
  // summary fields
  request?: string | null;
  investigated?: string | null;
  learned?: string | null;
  completed?: string | null;
  next_steps?: string | null;
}

export function getStats(): Promise<Stats> {
  return fetchJson('/api/dashboard/stats');
}

export function getProjects(): Promise<{ projects: Project[] }> {
  return fetchJson('/api/dashboard/projects');
}

export function getSessions(project?: string, limit = 50, offset = 0): Promise<{ sessions: Session[]; total: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (project) params.set('project', project);
  return fetchJson(`/api/dashboard/sessions?${params}`);
}

export function getSessionObservations(sessionId: number): Promise<{ observations: Observation[] }> {
  return fetchJson(`/api/dashboard/sessions/${sessionId}/observations`);
}

export function getFeed(project?: string, limit = 30, before?: number): Promise<{ feed: FeedItem[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (project) params.set('project', project);
  if (before) params.set('before', String(before));
  return fetchJson(`/api/dashboard/feed?${params}`);
}

export function search(q: string, project?: string): Promise<{ results: any[]; mode: string }> {
  const params = new URLSearchParams({ q });
  if (project) params.set('project', project);
  return fetchJson(`/api/search?${params}`);
}

// Delete operations
async function fetchDelete(url: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}${url}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function deleteObservation(id: number): Promise<{ ok: boolean }> {
  return fetchDelete(`/api/observations/${id}`);
}

export function deleteSummary(id: number): Promise<{ ok: boolean }> {
  return fetchDelete(`/api/summaries/${id}`);
}

export function deleteSession(id: number): Promise<{ ok: boolean }> {
  return fetchDelete(`/api/sessions/${id}`);
}

// Context preview
export interface ContextBreakdown {
  context: string;
  estimatedTokens: number;
  summaries: {
    id: number;
    session_id: number;
    project: string;
    request: string | null;
    investigated: string | null;
    learned: string | null;
    completed: string | null;
    next_steps: string | null;
    created_at: string;
    created_at_epoch: number;
  }[];
  observations: Observation[];
  detailedIds: number[];
}

export function getContextPreview(project?: string): Promise<ContextBreakdown> {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  return fetchJson(`/api/dashboard/context-preview?${params}`);
}

// Settings
export interface SettingsData {
  WORKER_PORT: number;
  OBSERVATION_COUNT: number;
  FULL_OBSERVATION_COUNT: number;
  SUMMARY_COUNT: number;
  OLLAMA_URL: string;
  OLLAMA_MODEL: string;
}

export function getSettingsData(): Promise<SettingsData> {
  return fetchJson('/api/settings');
}

// Cleanup
export interface CleanupResult {
  id: number;
  type: 'observation' | 'summary';
  action: 'keep' | 'delete';
  reason: string;
}

export interface PendingItem {
  id: number;
  type: 'observation' | 'summary';
  text: string;
}

export async function reviewCleanupStream(
  project: string | undefined,
  onItems: (items: PendingItem[]) => void,
  onResult: (result: CleanupResult) => void,
  onDone: (results: CleanupResult[], totalReviewed: number) => void,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min timeout
  const res = await fetch(`${BASE}/api/cleanup/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
    signal: controller.signal,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'items') {
              onItems(data.items);
            } else if (currentEvent === 'result') {
              onResult(data);
            } else if (currentEvent === 'done') {
              onDone(data.results || [], data.totalReviewed || 0);
            }
          } catch {}
          currentEvent = '';
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.cancel();
  }
}

export async function applyCleanup(deletions: { id: number; type: 'observation' | 'summary' }[]): Promise<{ ok: boolean; deleted: number }> {
  const res = await fetch(`${BASE}/api/cleanup/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deletions }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function updateSettings(settings: Partial<SettingsData>): Promise<SettingsData> {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
