import type { Observation, SearchIndexResult } from '../db/queries.js';

const TYPE_ICONS: Record<string, string> = {
  bugfix: '🔴',
  feature: '🟢',
  refactor: '🟣',
  discovery: '🔵',
  decision: '🧠',
  change: '⚪',
};

function typeIcon(type: string): string {
  return TYPE_ICONS[type] || '⚪';
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function estimateTokens(obs: { title?: string | null; narrative?: string | null; facts?: string | null }): number {
  const size = (obs.title || '').length + (obs.narrative || '').length + (obs.facts || '').length;
  return Math.ceil(size / 4);
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function formatSearchIndex(results: SearchIndexResult[]): string {
  if (results.length === 0) return 'No results found.';

  const lines: string[] = [];
  lines.push(`Found ${results.length} result(s):\n`);
  lines.push('| ID | Time | T | Title | ~Tokens |');
  lines.push('|----|------|---|-------|---------|');

  let lastTime = '';
  for (const r of results) {
    const time = formatTime(r.created_at);
    const displayTime = time === lastTime ? '″' : time;
    lastTime = time;

    lines.push(
      `| #${r.id} | ${displayTime} | ${typeIcon(r.type)} | ${truncate(r.title || 'Untitled', 60)} | ~${estimateTokens(r)} |`
    );
  }

  lines.push('');
  lines.push('Use `memory_timeline` with an ID to see context, or `memory_get` with IDs to fetch full details.');
  return lines.join('\n');
}

export function formatTimeline(
  before: Observation[],
  anchor: Observation,
  after: Observation[]
): string {
  const all = [...before, anchor, ...after];
  const lines: string[] = [];

  lines.push(`Timeline around #${anchor.id}: "${anchor.title || 'Untitled'}"\n`);
  lines.push(`${before.length} before → anchor → ${after.length} after\n`);

  // Group by day
  const byDay = new Map<string, { obs: Observation; isAnchor: boolean }[]>();
  for (const obs of all) {
    const day = formatDate(obs.created_at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push({ obs, isAnchor: obs.id === anchor.id });
  }

  for (const [day, items] of byDay) {
    lines.push(`### ${day}`);
    lines.push('| ID | Time | T | Title | ~Tokens |');
    lines.push('|----|------|---|-------|---------|');

    let lastTime = '';
    for (const { obs, isAnchor } of items) {
      const time = formatTime(obs.created_at);
      const displayTime = time === lastTime ? '″' : time;
      lastTime = time;
      const marker = isAnchor ? ' ← **ANCHOR**' : '';

      lines.push(
        `| #${obs.id} | ${displayTime} | ${typeIcon(obs.type)} | ${truncate(obs.title || 'Untitled', 60)}${marker} | ~${estimateTokens(obs)} |`
      );
    }
    lines.push('');
  }

  lines.push('Use `memory_get` with specific IDs to fetch full observation details.');
  return lines.join('\n');
}

export function formatObservationsFull(observations: Observation[]): string {
  if (observations.length === 0) return 'No observations found for the given IDs.';

  const lines: string[] = [];
  for (const obs of observations) {
    lines.push(`## #${obs.id} — ${obs.title || 'Untitled'}`);
    lines.push(`**Type:** ${typeIcon(obs.type)} ${obs.type} | **Time:** ${formatTime(obs.created_at)} ${formatDate(obs.created_at)}`);

    const facts = parseJsonArray(obs.facts);
    if (facts.length > 0) {
      lines.push(`**Facts:** ${facts.join('; ')}`);
    }
    if (obs.narrative) {
      lines.push(`**Narrative:** ${obs.narrative}`);
    }
    const filesRead = parseJsonArray(obs.files_read);
    const filesMod = parseJsonArray(obs.files_modified);
    if (filesRead.length > 0 || filesMod.length > 0) {
      const parts: string[] = [];
      if (filesRead.length > 0) parts.push(`read: ${filesRead.join(', ')}`);
      if (filesMod.length > 0) parts.push(`modified: ${filesMod.join(', ')}`);
      lines.push(`**Files:** ${parts.join(' | ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function parseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
