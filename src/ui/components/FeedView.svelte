<script lang="ts">
  import { getFeed, type FeedItem } from '../api';
  import FeedItemComponent from './FeedItem.svelte';

  let { project = '' }: { project?: string } = $props();

  let items: FeedItem[] = $state([]);
  let loading = $state(true);
  let hasMore = $state(true);

  async function load(reset = false) {
    loading = true;
    const before = reset ? undefined : items[items.length - 1]?.created_at_epoch;
    const { feed } = await getFeed(project || undefined, 30, before);
    if (reset) {
      items = feed;
    } else {
      items = [...items, ...feed];
    }
    hasMore = feed.length === 30;
    loading = false;
  }

  $effect(() => {
    // re-run when project changes
    void project;
    load(true);
  });
</script>

<div class="feed">
  {#each items as item (item.item_type + '-' + item.id)}
    <FeedItemComponent {item} />
  {/each}

  {#if loading}
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
