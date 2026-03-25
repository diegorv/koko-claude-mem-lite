<script lang="ts">
  import type { Stats } from '../api';
  let { stats }: { stats: Stats } = $props();

  function fmtUptime(s: number): string {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  let maxDaily = $derived(Math.max(...(stats.daily?.map(d => d.count) || [1]), 1));
</script>

<div class="stats">
  <div class="stat-card">
    <div class="label">Sessions</div>
    <div class="value">{stats.sessions}</div>
    {#if stats.activeSessions > 0}
      <div class="stat-sub">{stats.activeSessions} active</div>
    {/if}
  </div>
  <div class="stat-card">
    <div class="label">Observations</div>
    <div class="value">{stats.observations}</div>
    {#if stats.types && stats.types.length > 0}
      <div class="type-breakdown">
        {#each stats.types as t}
          <span class="type-tag {t.type}">{t.type} {t.count}</span>
        {/each}
      </div>
    {/if}
  </div>
  <div class="stat-card">
    <div class="label">Summaries</div>
    <div class="value">{stats.summaries}</div>
  </div>
  <div class="stat-card">
    <div class="label">Queue</div>
    <div class="value">{stats.pendingMessages ?? 0}</div>
    {#if stats.activeObservers > 0}
      <div class="stat-sub">{stats.activeObservers} observer{stats.activeObservers > 1 ? 's' : ''} active</div>
    {:else}
      <div class="stat-sub">idle</div>
    {/if}
  </div>
  <div class="stat-card">
    <div class="label">Activity (7d)</div>
    {#if stats.daily && stats.daily.length > 0}
      <div class="sparkline">
        {#each stats.daily as d}
          <div class="spark-bar" title="{d.day}: {d.count}" style="height: {Math.max(4, (d.count / maxDaily) * 32)}px"></div>
        {/each}
      </div>
    {:else}
      <div class="value" style="font-size: 11px; color: var(--text-dim);">No data</div>
    {/if}
    {#if stats.uptime}
      <div class="stat-sub">worker up {fmtUptime(stats.uptime)}</div>
    {/if}
  </div>
</div>
