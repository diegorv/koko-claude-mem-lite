<script lang="ts">
  import type { Stats } from '../api';
  let { stats }: { stats: Stats } = $props();
</script>

<div class="stats">
  <div class="stat-card">
    <div class="label">Sessions</div>
    <div class="value">{stats.sessions}</div>
  </div>
  <div class="stat-card">
    <div class="label">Observations</div>
    <div class="value">{stats.observations}</div>
  </div>
  <div class="stat-card">
    <div class="label">Summaries</div>
    <div class="value">{stats.summaries}</div>
  </div>
  <div class="stat-card">
    <div class="label">Projects</div>
    <div class="value">{stats.projects}</div>
  </div>
</div>
