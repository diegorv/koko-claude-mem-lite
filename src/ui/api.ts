const BASE = '';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface Stats {
  sessions: number;
  observations: number;
  summaries: number;
  projects: number;
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
