<script lang="ts">
  import { getFeed, type FeedItem } from '../api';
  import FeedItemComponent from './FeedItem.svelte';

  let { project = '' }: { project?: string } = $props();

  let items: FeedItem[] = $state([]);
  let loading = $state(true);
  let hasMore = $state(true);

  let error: string | null = $state(null);

  async function load(reset = false) {
    loading = true;
    error = null;
    try {
      const before = reset ? undefined : items[items.length - 1]?.created_at_epoch;
      const { feed } = await getFeed(project || undefined, 30, before);
      if (reset) {
        items = feed;
      } else {
        items = [...items, ...feed];
      }
      hasMore = feed.length === 30;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load feed';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // re-run when project changes
    void project;
    load(true);
  });
</script>

<div class="feed">
  {#each items as item (item.item_type + '-' + item.id)}
    <FeedItemComponent {item} ondelete={(deleted) => { items = items.filter(i => !(i.item_type === deleted.item_type && i.id === deleted.id)); }} />
  {/each}

  {#if error}
    <div class="empty"><div class="icon">!</div><div>{error}</div></div>
  {:else if loading}
    <div class="loading"><span class="loading-pulse">Loading...</span></div>
  {:else if items.length === 0}
    <div class="empty">
      <div class="icon">~</div>
      <div>No activity yet. Start a Claude Code session to see data here.</div>
    </div>
  {:else if hasMore}
    <div class="load-more">
      <button onclick={() => load(false)}>Load more</button>
    </div>
  {/if}
</div>
