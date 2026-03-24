<script lang="ts">
  import { getContextPreview, deleteObservation, deleteSummary, reviewCleanupStream, applyCleanup, type ContextBreakdown, type CleanupResult, type PendingItem } from '../api';

  let { project = '' }: { project?: string } = $props();

  let data: ContextBreakdown | null = $state(null);
  let loading = $state(true);
  let error = $state('');
  let viewMode: 'structured' | 'raw' = $state('structured');
  let confirmDeleteType: string = $state('');
  let confirmDeleteId: number | null = $state(null);
  let deleting = $state(false);

  // Cleanup state
  let cleanupResults: CleanupResult[] = $state([]);
  let pendingItems: PendingItem[] = $state([]);
  let cleanupRunning = $state(false);
  let cleanupDone = $state(false);
  let cleanupApplying = $state(false);
  let cleanupMessage = $state('');

  async function load() {
    loading = true;
    error = '';
    cleanupResults = [];
    cleanupDone = false;
    cleanupMessage = '';
    try {
      data = await getContextPreview(project || undefined);
    } catch (err) {
      error = 'Failed to load context preview';
      console.error(err);
    } finally {
      loading = false;
    }
  }

  async function handleDelete(type: 'observation' | 'summary', id: number) {
    deleting = true;
    try {
      if (type === 'observation') {
        await deleteObservation(id);
        if (data) {
          data.observations = data.observations.filter(o => o.id !== id);
          data.detailedIds = data.detailedIds.filter(did => did !== id);
        }
      } else {
        await deleteSummary(id);
        if (data) {
          data.summaries = data.summaries.filter(s => s.id !== id);
        }
      }
      const fresh = await getContextPreview(project || undefined);
      if (data) {
        data.context = fresh.context;
        data.estimatedTokens = fresh.estimatedTokens;
      }
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      deleting = false;
      confirmDeleteType = '';
      confirmDeleteId = null;
    }
  }

  // Set of IDs that have been resolved (have a result)
  let resolvedIds = $state(new Set<string>());

  async function runCleanup() {
    cleanupRunning = true;
    cleanupMessage = '';
    cleanupResults = [];
    pendingItems = [];
    resolvedIds = new Set();
    cleanupDone = false;
    try {
      await reviewCleanupStream(
        project || undefined,
        (items) => { pendingItems = items; },
        (result) => {
          cleanupResults = [...cleanupResults, result];
          resolvedIds = new Set([...resolvedIds, `${result.type}-${result.id}`]);
        },
        (results, totalReviewed) => {
          if (results.length > 0) {
            cleanupResults = results;
          }
          pendingItems = [];
          cleanupDone = true;
          if (cleanupResults.length === 0) {
            cleanupMessage = 'Cleanup failed — no results returned. Check worker logs for errors.';
          } else {
            const toDelete = cleanupResults.filter(r => r.action === 'delete');
            cleanupMessage = `Reviewed ${totalReviewed} items. ${toDelete.length} flagged for deletion.`;
          }
        },
      );
    } catch (err) {
      cleanupMessage = 'Cleanup review failed. Is Claude Agent SDK available?';
      console.error(err);
    } finally {
      cleanupRunning = false;
    }
  }

  let deletedMessage = $state('');

  async function applyCleanupResults() {
    cleanupApplying = true;
    try {
      const toDelete = cleanupResults.filter(r => r.action === 'delete').map(r => ({ id: r.id, type: r.type }));
      const obsBefore = data?.observations.length || 0;
      const sumBefore = data?.summaries.length || 0;
      const tokensBefore = data?.estimatedTokens || 0;

      const res = await applyCleanup(toDelete);

      cleanupResults = [];
      cleanupDone = false;
      cleanupMessage = '';
      await load();

      const tokensAfter = data?.estimatedTokens || 0;
      const tokensSaved = tokensBefore - tokensAfter;
      deletedMessage = `Deleted ${res.deleted} items. Saved ~${tokensSaved.toLocaleString()} tokens (${tokensBefore.toLocaleString()} -> ${tokensAfter.toLocaleString()}).`;
      setTimeout(() => deletedMessage = '', 8000);
    } catch (err) {
      cleanupMessage = 'Failed to apply cleanup';
      console.error(err);
    } finally {
      cleanupApplying = false;
    }
  }

  function toggleCleanupItem(id: number, type: string) {
    cleanupResults = cleanupResults.map(r =>
      (r.id === id && r.type === type) ? { ...r, action: r.action === 'delete' ? 'keep' : 'delete' } : r
    );
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleString('en', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function parseJson(s: string | null): string[] {
    if (!s) return [];
    try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; }
  }

  function basename(path: string): string {
    return path.split('/').pop() || path;
  }

  $effect(() => {
    void project;
    load();
  });

  let deletionsCount = $derived(cleanupResults.filter(r => r.action === 'delete').length);
</script>

<div class="context-view">
  <div class="context-header">
    <div class="context-info">
      <span class="context-label">Injected on next SessionStart</span>
      {#if data && data.estimatedTokens > 0}
        <span class="token-estimate">~{data.estimatedTokens.toLocaleString()} tokens</span>
      {/if}
      {#if data}
        <span class="context-count">{data.summaries.length} summaries, {data.observations.length} observations</span>
      {/if}
    </div>
    <div class="context-actions">
      <button class="cleanup-btn" class:active={cleanupRunning} onclick={runCleanup} disabled={cleanupRunning || loading}>
        {#if cleanupRunning}
          <span class="loading-pulse">Analyzing {pendingItems.length} items...</span>
        {:else}
          AI Cleanup
        {/if}
      </button>
      <div class="view-toggle">
        <button class:active={viewMode === 'structured'} onclick={() => viewMode = 'structured'}>Items</button>
        <button class:active={viewMode === 'raw'} onclick={() => viewMode = 'raw'}>Raw</button>
      </div>
      <button class="refresh-btn" onclick={load} disabled={loading}>
        {loading ? 'Loading...' : 'Refresh'}
      </button>
    </div>
  </div>

  <!-- Cleanup: pending items being analyzed (with live results) -->
  {#if cleanupRunning && pendingItems.length > 0}
    <div class="cleanup-panel">
      <div class="cleanup-panel-header">
        <span class="cleanup-panel-title loading-pulse">Analyzing {pendingItems.length} items... ({cleanupResults.length}/{pendingItems.length})</span>
        <span class="cleanup-panel-count">Claude is reviewing each item for quality</span>
      </div>
      <div class="cleanup-list">
        {#each pendingItems as item (item.type + '-' + item.id)}
          {@const result = cleanupResults.find(r => r.id === item.id && r.type === item.type)}
          {#if result}
            <div class="cleanup-item" class:to-delete={result.action === 'delete'} class:to-keep={result.action === 'keep'}>
              <span class="cleanup-toggle">{result.action === 'delete' ? '[-]' : '[+]'}</span>
              <span class="cleanup-type badge {item.type === 'summary' ? 'summary' : 'raw'}">{item.type}</span>
              <span class="cleanup-id">#{item.id}</span>
              <span class="cleanup-reason">{result.reason}</span>
            </div>
          {:else}
            <div class="cleanup-item pending">
              <span class="cleanup-toggle loading-pulse">[ ]</span>
              <span class="cleanup-type badge {item.type === 'summary' ? 'summary' : 'raw'}">{item.type}</span>
              <span class="cleanup-id">#{item.id}</span>
              <span class="cleanup-reason">{item.text.slice(0, 80)}{item.text.length > 80 ? '...' : ''}</span>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}

  <!-- Cleanup results panel (after done) -->
  {#if cleanupDone && cleanupResults.length > 0}
    <div class="cleanup-panel">
      <div class="cleanup-panel-header">
        <span class="cleanup-panel-title">AI Cleanup Review</span>
        <span class="cleanup-panel-count">{deletionsCount} to delete, {cleanupResults.length - deletionsCount} to keep</span>
        <div class="cleanup-panel-actions">
          <button class="delete-yes" onclick={applyCleanupResults} disabled={cleanupApplying || deletionsCount === 0}>
            {cleanupApplying ? 'Deleting...' : `Delete ${deletionsCount} items`}
          </button>
          <button class="delete-cancel" onclick={() => { cleanupResults = []; cleanupDone = false; cleanupMessage = ''; }}>Dismiss</button>
        </div>
      </div>
      <div class="cleanup-list">
        {#each cleanupResults as r (r.type + '-' + r.id)}
          <div class="cleanup-item" class:to-delete={r.action === 'delete'} class:to-keep={r.action === 'keep'}>
            <button class="cleanup-toggle" onclick={() => toggleCleanupItem(r.id, r.type)}>
              {r.action === 'delete' ? '[-]' : '[+]'}
            </button>
            <span class="cleanup-type badge {r.type === 'summary' ? 'summary' : 'raw'}">{r.type}</span>
            <span class="cleanup-id">#{r.id}</span>
            <span class="cleanup-reason">{r.reason}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if deletedMessage}
    <div class="cleanup-success">{deletedMessage}</div>
  {/if}

  {#if cleanupMessage && (cleanupDone && cleanupResults.length === 0 || !cleanupDone)}
    <div class="cleanup-message">{cleanupMessage}</div>
  {/if}

  {#if loading}
    <div class="loading"><span class="loading-pulse">Loading context preview...</span></div>
  {:else if error}
    <div class="empty">{error}</div>
  {:else if !data || (!data.summaries.length && !data.observations.length)}
    <div class="empty">
      <div class="icon">~</div>
      <div>No context to inject yet. Start a Claude Code session to generate data.</div>
    </div>
  {:else if viewMode === 'raw'}
    <div class="context-preview">
      <pre>{data.context}</pre>
    </div>
  {:else}
    <!-- Summaries section -->
    {#if data.summaries.length > 0}
      <div class="context-section">
        <div class="context-section-header">
          <span class="context-section-title">Summaries</span>
          <span class="context-section-count">{data.summaries.length} items</span>
        </div>
        {#each data.summaries as s (s.id)}
          <div class="context-item">
            <div class="context-item-header">
              <span class="badge summary">summary</span>
              <span class="context-item-title">{s.request || 'Session'}</span>
              <span class="timestamp">{formatTime(s.created_at)}</span>
              {#if confirmDeleteType === 'summary' && confirmDeleteId === s.id}
                <span class="delete-confirm">
                  <span class="delete-confirm-text">Remove from context?</span>
                  <button class="delete-yes" onclick={() => handleDelete('summary', s.id)} disabled={deleting}>{deleting ? '...' : 'Yes'}</button>
                  <button class="delete-cancel" onclick={() => { confirmDeleteType = ''; confirmDeleteId = null; }}>No</button>
                </span>
              {:else}
                <button class="delete-btn context-delete" title="Delete summary" onclick={() => { confirmDeleteType = 'summary'; confirmDeleteId = s.id; }}>&#x2715;</button>
              {/if}
            </div>
            <div class="context-item-body">
              {#if s.completed}<div class="context-field"><span class="context-field-label">Completed:</span> {s.completed}</div>{/if}
              {#if s.learned}<div class="context-field"><span class="context-field-label">Learned:</span> {s.learned}</div>{/if}
              {#if s.next_steps}<div class="context-field"><span class="context-field-label">Next steps:</span> {s.next_steps}</div>{/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Observations section -->
    {#if data.observations.length > 0}
      <div class="context-section">
        <div class="context-section-header">
          <span class="context-section-title">Observations</span>
          <span class="context-section-count">{data.observations.length} in activity table, {data.detailedIds.length} with full detail</span>
        </div>
        {#each data.observations as obs (obs.id)}
          {@const isDetailed = data!.detailedIds.includes(obs.id)}
          <div class="context-item" class:detailed={isDetailed}>
            <div class="context-item-header">
              <span class="badge {obs.type}">{obs.type}</span>
              {#if isDetailed}
                <span class="detail-badge">full detail</span>
              {/if}
              <span class="context-item-title">{obs.title || '-'}</span>
              <span class="timestamp">{formatTime(obs.created_at)}</span>
              {#if confirmDeleteType === 'observation' && confirmDeleteId === obs.id}
                <span class="delete-confirm">
                  <span class="delete-confirm-text">Delete?</span>
                  <button class="delete-yes" onclick={() => handleDelete('observation', obs.id)} disabled={deleting}>{deleting ? '...' : 'Yes'}</button>
                  <button class="delete-cancel" onclick={() => { confirmDeleteType = ''; confirmDeleteId = null; }}>No</button>
                </span>
              {:else}
                <button class="delete-btn context-delete" title="Delete observation" onclick={() => { confirmDeleteType = 'observation'; confirmDeleteId = obs.id; }}>&#x2715;</button>
              {/if}
            </div>
            {#if isDetailed}
              <div class="context-item-body">
                {#if obs.narrative}<div class="context-field">{obs.narrative}</div>{/if}
                {#if parseJson(obs.facts).length > 0}
                  <div class="context-field"><span class="context-field-label">Facts:</span> {parseJson(obs.facts).join('; ')}</div>
                {/if}
                {#if [...parseJson(obs.files_read), ...parseJson(obs.files_modified)].length > 0}
                  <div class="context-field context-files">{[...parseJson(obs.files_read).map(f => basename(f)), ...parseJson(obs.files_modified).map(f => basename(f))].join(', ')}</div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
