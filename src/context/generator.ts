import { getRecentObservations, getRecentSummaries, type Observation, type Summary } from '../db/queries.js';
import { getSetting } from '../utils/settings.js';

export interface ContextBreakdown {
  context: string;
  estimatedTokens: number;
  summaries: Summary[];
  observations: Observation[];
  detailedIds: number[];  // observation IDs that get full detail in timeline
}

export function generateContextDetailed(project: string): ContextBreakdown {
  const observationCount = getSetting('OBSERVATION_COUNT');
  const fullDetailCount = getSetting('FULL_OBSERVATION_COUNT');
  const summaryCount = getSetting('SUMMARY_COUNT');

  const summaries = getRecentSummaries(project, summaryCount);
  const observations = getRecentObservations(project, observationCount);
  const detailedIds = observations.slice(0, fullDetailCount).map(o => o.id);
  const context = generateContext(project);

  return {
    context,
    estimatedTokens: Math.ceil(context.length / 4),
    summaries,
    observations,
    detailedIds,
  };
}

// --- Type icons for compact timeline ---
const TYPE_ICONS: Record<string, string> = {
  bugfix: '[fix]',
  feature: '[feat]',
  refactor: '[refactor]',
  discovery: '[discovery]',
  decision: '[decision]',
  change: '[change]',
};

function typeIcon(type: string): string {
  return TYPE_ICONS[type] || `[${type}]`;
}

// --- Timeline item types ---
interface TimelineEntry {
  kind: 'observation' | 'summary';
  epoch: number;
  data: Observation | Summary;
}

export function generateContext(project: string): string {
  const observationCount = getSetting('OBSERVATION_COUNT');
  const fullDetailCount = getSetting('FULL_OBSERVATION_COUNT');
  const summaryCount = getSetting('SUMMARY_COUNT');

  const summaries = getRecentSummaries(project, summaryCount);
  const observations = getRecentObservations(project, observationCount);

  if (summaries.length === 0 && observations.length === 0) {
    return '';
  }

  // Build unified timeline sorted chronologically (oldest first)
  const fullIds = new Set(observations.slice(0, fullDetailCount).map(o => o.id));

  const timeline: TimelineEntry[] = [
    ...observations.map(o => ({ kind: 'observation' as const, epoch: o.created_at_epoch, data: o })),
    ...summaries.map(s => ({ kind: 'summary' as const, epoch: s.created_at_epoch, data: s })),
  ];
  timeline.sort((a, b) => a.epoch - b.epoch);

  // Group by day
  const dayGroups = new Map<string, TimelineEntry[]>();
  for (const entry of timeline) {
    const day = formatDay(entry.data.created_at);
    if (!dayGroups.has(day)) dayGroups.set(day, []);
    dayGroups.get(day)!.push(entry);
  }

  const lines: string[] = [];
  lines.push('<memory-lite-context>');
  lines.push(`# Memory Context | ${project}`);
  lines.push('');

  for (const [day, entries] of dayGroups) {
    lines.push(`### ${day}`);

    for (const entry of entries) {
      if (entry.kind === 'summary') {
        const s = entry.data as Summary;
        lines.push(`S${s.id} ${s.request || 'Session'}`);
        if (s.completed) lines.push(`  Done: ${s.completed}`);
        if (s.learned) lines.push(`  Learned: ${s.learned}`);
        if (s.next_steps) lines.push(`  Next: ${s.next_steps}`);
      } else {
        const obs = entry.data as Observation;
        const time = formatTime(obs.created_at);
        const isFull = fullIds.has(obs.id);

        if (isFull) {
          const concepts = parseJsonArray(obs.concepts);
          const conceptBadges = concepts.length > 0 ? '  ' + concepts.map(c => `[${c}]`).join('') : '';
          lines.push(`**${obs.id}** ${time} ${typeIcon(obs.type)} **${obs.title || 'Untitled'}**${conceptBadges}`);
          if (obs.subtitle) lines.push(`  ${obs.subtitle}`);
          if (obs.narrative) lines.push(`  ${obs.narrative}`);
          const facts = parseJsonArray(obs.facts);
          for (const fact of facts) lines.push(`  - ${fact}`);
          const files = parseJsonArray(obs.files_modified);
          if (files.length > 0) lines.push(`  Files: ${files.join(', ')}`);
        } else {
          const subtitle = obs.subtitle ? ` — ${obs.subtitle}` : '';
          const concepts = parseJsonArray(obs.concepts);
          const highSignal = concepts.filter(c => c === 'gotcha' || c === 'trade-off');
          const badges = highSignal.length > 0 ? ' ' + highSignal.map(c => `[${c}]`).join('') : '';
          lines.push(`${obs.id} ${time} ${typeIcon(obs.type)} ${obs.title || '-'}${subtitle}${badges}`);
        }
      }
    }
    lines.push('');
  }

  lines.push('</memory-lite-context>');
  return lines.join('\n');
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
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
