<script lang="ts">
  import { getContextPreview } from '../api';

  let { project = '' }: { project?: string } = $props();

  let context = $state('');
  let estimatedTokens = $state(0);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await getContextPreview(project || undefined);
      context = res.context;
      estimatedTokens = res.estimatedTokens;
    } catch (err) {
      error = 'Failed to load context preview';
      console.error(err);
    } finally {
      loading = false;
    }
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
      {#if estimatedTokens > 0}
        <span class="token-estimate">~{estimatedTokens.toLocaleString()} tokens</span>
      {/if}
    </div>
    <button class="refresh-btn" onclick={load} disabled={loading}>
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if loading}
    <div class="loading"><span class="loading-pulse">Loading context preview...</span></div>
  {:else if error}
    <div class="empty">{error}</div>
  {:else if !context}
    <div class="empty">
      <div class="icon">~</div>
      <div>No context to inject yet. Start a Claude Code session to generate data.</div>
    </div>
  {:else}
    <div class="context-preview">
      <pre>{context}</pre>
    </div>
  {/if}
</div>
