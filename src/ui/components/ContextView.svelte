<script lang="ts">
  import { getContextPreview, deleteObservation, deleteSummary, type ContextBreakdown, type Observation } from '../api';

  let { project = '' }: { project?: string } = $props();

  let data: ContextBreakdown | null = $state(null);
  let loading = $state(true);
  let error = $state('');
  let viewMode: 'structured' | 'raw' = $state('structured');
  let confirmDeleteType: string = $state('');
  let confirmDeleteId: number | null = $state(null);
  let deleting = $state(false);

  async function load() {
    loading = true;
    error = '';
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
      // Re-fetch to update the raw markdown and token count
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
      <div class="view-toggle">
        <button class:active={viewMode === 'structured'} onclick={() => viewMode = 'structured'}>Items</button>
        <button class:active={viewMode === 'raw'} onclick={() => viewMode = 'raw'}>Raw</button>
      </div>
      <button class="refresh-btn" onclick={load} disabled={loading}>
        {loading ? 'Loading...' : 'Refresh'}
      </button>
    </div>
  </div>

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
