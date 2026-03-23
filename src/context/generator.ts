import { getRecentObservations, getRecentSummaries } from '../db/queries.js';
import { getSetting } from '../utils/settings.js';

export function generateContext(project: string): string {
  const observationCount = getSetting('OBSERVATION_COUNT');
  const fullDetailCount = getSetting('FULL_OBSERVATION_COUNT');
  const summaryCount = getSetting('SUMMARY_COUNT');

  const summaries = getRecentSummaries(project, summaryCount);
  const observations = getRecentObservations(project, observationCount);

  if (summaries.length === 0 && observations.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push(`<memory-lite-context>`);
  lines.push(`# Memory Context | ${project}`);
  lines.push('');

  // Recent summaries
  if (summaries.length > 0) {
    lines.push('## Recent Summaries');
    for (const s of summaries) {
      const date = new Date(s.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      lines.push(`### ${date} - ${s.request || 'Session'}`);
      if (s.completed) lines.push(`- **Completed:** ${s.completed}`);
      if (s.learned) lines.push(`- **Learned:** ${s.learned}`);
      if (s.next_steps) lines.push(`- **Next steps:** ${s.next_steps}`);
      lines.push('');
    }
  }

  // Recent activity table
  if (observations.length > 0) {
    lines.push('## Recent Activity');
    lines.push('| Time | Type | Title | Files |');
    lines.push('|------|------|-------|-------|');

    for (const obs of observations) {
      const time = new Date(obs.created_at).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const files = [
        ...parseJsonArray(obs.files_read),
        ...parseJsonArray(obs.files_modified),
      ].map(f => basename(f)).join(', ');

      lines.push(`| ${time} | ${obs.type} | ${obs.title || '-'} | ${files || '-'} |`);
    }
    lines.push('');

    // Full details for most recent observations
    const detailed = observations.slice(0, fullDetailCount);
    if (detailed.length > 0) {
      lines.push(`## Details (last ${detailed.length})`);
      for (const obs of detailed) {
        lines.push(`### #${obs.id} - ${obs.title || 'Untitled'}`);
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
    }
  }

  lines.push('</memory-lite-context>');
  return lines.join('\n');
}

function parseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}
