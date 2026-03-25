<script lang="ts">
  import { getLive, type LiveData } from '../api';

  let data: LiveData | null = $state(null);
  let error: string | null = $state(null);
  let interval: ReturnType<typeof setInterval> | null = null;

  async function load() {
    try {
      data = await getLive();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    }
  }

  function fmtAge(ms: number): string {
    if (ms < 1000) return 'just now';
    if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
    return `${Math.floor(ms / 3600000)}h ago`;
  }

  function fmtTime(epoch: number): string {
    const ms = Date.now() - epoch;
    return fmtAge(ms);
  }

  $effect(() => {
    load();
    interval = setInterval(load, 3000);
    return () => { if (interval) clearInterval(interval); };
  });
</script>

<div class="live-view">
  {#if error}
    <div class="empty"><div class="icon">!</div><div>{error}</div></div>
  {:else if !data}
    <div class="loading"><span class="loading-pulse">Loading...</span></div>
  {:else}

    <div class="live-section">
      <div class="live-section-header">
        <span class="live-section-title">Active Observers</span>
        <span class="live-section-count">{data.observers.length}</span>
      </div>
      {#if data.observers.length === 0}
        <div class="live-empty">No active observers — worker is idle</div>
      {:else}
        {#each data.observers as obs}
          <div class="live-row">
            <span class="live-dot active"></span>
            <span class="live-row-project">{obs.project}</span>
            <span class="live-row-id">{obs.contentSessionId.slice(0, 8)}</span>
            <span class="live-row-meta">
              {#if obs.pendingCount > 0}
                <span class="live-badge pending">{obs.pendingCount} pending</span>
              {:else}
                <span class="live-badge idle">idle</span>
              {/if}
            </span>
            <span class="live-row-age">{fmtAge(obs.lastActivityAge)}</span>
          </div>
        {/each}
      {/if}
    </div>

    <div class="live-section">
      <div class="live-section-header">
        <span class="live-section-title">Message Queue</span>
        <span class="live-section-count">{data.queue.length}</span>
      </div>
      {#if data.queue.length === 0}
        <div class="live-empty">Queue is empty</div>
      {:else}
        <div class="live-queue-header">
          <span>id</span>
          <span>session</span>
          <span>project</span>
          <span>kind</span>
          <span>status</span>
          <span>age</span>
        </div>
        {#each data.queue as msg}
          <div class="live-row live-queue-row">
            <span class="live-row-id">#{msg.id}</span>
            <span class="live-row-id">{msg.content_session_id.slice(0, 8)}</span>
            <span class="live-row-project">{msg.project ?? '—'}</span>
            <span class="live-badge {msg.kind}">{msg.kind}</span>
            <span class="live-badge {msg.status}">{msg.status}</span>
            <span class="live-row-age">{fmtTime(msg.created_at_epoch)}</span>
          </div>
        {/each}
      {/if}
    </div>

  {/if}
</div>

<style>
  .live-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .live-section {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .live-section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-light);
    background: var(--bg);
  }

  .live-section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .live-section-count {
    font-size: 10px;
    color: var(--text-dim);
    background: var(--bg-surface);
    padding: 1px 6px;
    border-radius: 8px;
    border: 1px solid var(--border-light);
  }

  .live-empty {
    padding: 20px 16px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .live-queue-header {
    display: grid;
    grid-template-columns: 48px 80px 1fr 90px 90px 80px;
    gap: 8px;
    padding: 6px 16px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border-light);
  }

  .live-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-light);
    font-size: 12px;
  }

  .live-row:last-child {
    border-bottom: none;
  }

  .live-queue-row {
    display: grid;
    grid-template-columns: 48px 80px 1fr 90px 90px 80px;
    gap: 8px;
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .live-dot.active { background: var(--green); }

  .live-row-project {
    font-size: 12px;
    color: var(--text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-row-id {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font);
  }

  .live-row-meta {
    display: flex;
    gap: 4px;
  }

  .live-row-age {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    margin-left: auto;
  }

  .live-queue-row .live-row-age {
    margin-left: 0;
  }

  .live-badge {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 8px;
    white-space: nowrap;
    font-weight: 500;
  }

  .live-badge.pending { background: rgba(255, 184, 108, 0.15); color: var(--orange); }
  .live-badge.processing { background: rgba(139, 233, 253, 0.15); color: var(--accent); }
  .live-badge.idle { background: rgba(98, 114, 164, 0.15); color: var(--text-dim); }
  .live-badge.observation { background: rgba(139, 233, 253, 0.12); color: var(--accent); }
  .live-badge.summary { background: rgba(80, 250, 123, 0.12); color: var(--green); }
</style>
