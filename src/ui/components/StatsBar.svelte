<script lang="ts">
  import type { Stats } from '../api';
  let { stats }: { stats: Stats } = $props();

  function fmtUptime(s: number): string {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  let isActive = $derived((stats.activeObservers ?? 0) > 0 || (stats.activeSessions ?? 0) > 0);
  let totalActivity = $derived((stats.daily || []).reduce((sum, d) => sum + d.count, 0));
  let maxDaily = $derived(Math.max(...(stats.daily?.map(d => d.count) || [1]), 1));
</script>

<div class="live-panel {isActive ? 'active' : 'idle'}">
  <div class="live-cards">
    <div class="live-card">
      <div class="live-label">Sessions</div>
      <div class="live-value">{stats.activeSessions ?? 0}</div>
      <div class="live-sub">active now</div>
    </div>
    <div class="live-card">
      <div class="live-label">Observers</div>
      <div class="live-value">{stats.activeObservers ?? 0}</div>
      <div class="live-sub">{(stats.activeObservers ?? 0) > 0 ? 'processing' : 'idle'}</div>
    </div>
    <div class="live-card">
      <div class="live-label">Queue</div>
      <div class="live-value">{stats.pendingMessages ?? 0}</div>
      <div class="live-sub">messages</div>
    </div>
    <div class="live-card">
      <div class="live-label">Worker</div>
      <div class="live-value" style="font-size: 16px;">{stats.uptime ? fmtUptime(stats.uptime) : '—'}</div>
      <div class="live-sub">{stats.uptime ? 'uptime' : 'offline'}</div>
    </div>
  </div>

  <div class="totals-strip">
    <span class="total-item">{stats.sessions} sessions</span>
    <span class="total-sep">·</span>
    <span class="total-item">{stats.observations} observations</span>
    {#if stats.types && stats.types.length > 0}
      {#each stats.types as t}
        <span class="type-tag {t.type}">{t.type} {t.count}</span>
      {/each}
    {/if}
    <span class="total-sep">·</span>
    <span class="total-item">{stats.summaries} summaries</span>
    <span class="total-sep">·</span>
    <span class="total-item">{totalActivity} this week</span>
    {#if stats.daily && stats.daily.length > 0}
      <div class="sparkline-inline">
        {#each stats.daily as d}
          <div class="spark-bar-sm" title="{d.day}: {d.count}" style="height: {Math.max(3, (d.count / maxDaily) * 16)}px"></div>
        {/each}
      </div>
    {/if}
  </div>
</div>
