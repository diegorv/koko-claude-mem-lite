<script lang="ts">
  import { search } from '../api';
  import FeedItemComponent from './FeedItem.svelte';

  let { project = '', query = '' }: { project?: string; query?: string } = $props();

  let results: any[] = $state([]);
  let loading = $state(false);
  let searched = $state(false);
  let searchError: string | null = $state(null);
  let localQuery = $state(query);

  async function doSearch() {
    if (!localQuery.trim()) return;
    loading = true;
    searched = true;
    searchError = null;
    try {
      const res = await search(localQuery, project || undefined);
      results = res.results;
    } catch (err) {
      results = [];
      searchError = err instanceof Error ? err.message : 'Search failed';
    } finally {
      loading = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') doSearch();
  }

  $effect(() => {
    if (query && query !== localQuery) {
      localQuery = query;
      doSearch();
    }
  });
</script>

<div style="margin-bottom: 12px; display: flex; gap: 8px;">
  <input
    type="text"
    placeholder="Search observations (FTS)..."
    bind:value={localQuery}
    onkeydown={onKeydown}
    style="flex: 1; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); padding: 8px 12px; font-family: var(--font); font-size: 12px;"
  />
  <button
    onclick={doSearch}
    style="background: var(--accent-dim); border: 1px solid var(--accent); border-radius: var(--radius-sm); color: var(--text); padding: 8px 16px; font-family: var(--font); font-size: 12px; cursor: pointer;"
  >Search</button>
</div>

{#if loading}
  <div class="loading"><span class="loading-pulse">Searching...</span></div>
{:else if results.length > 0}
  <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 8px;">{results.length} results</div>
  <div class="feed">
    {#each results as r}
      <FeedItemComponent item={{ ...r, item_type: 'observation' }} ondelete={(deleted) => { results = results.filter(i => i.id !== deleted.id); }} />
    {/each}
  </div>
{:else if searchError}
  <div class="empty">{searchError}</div>
{:else if searched}
  <div class="empty">No results found for "{localQuery}"</div>
{/if}
