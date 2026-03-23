<script lang="ts">
  import type { FeedItem } from '../api';
  let { item }: { item: FeedItem } = $props();

  function parseJson(s: string | null | undefined): any[] {
    if (!s) return [];
    try { return JSON.parse(s); } catch { return []; }
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }

  let facts = $derived(parseJson(item.facts));
  let filesRead = $derived(parseJson(item.files_read));
  let filesModified = $derived(parseJson(item.files_modified));
  let allFiles = $derived([...filesModified, ...filesRead.filter((f: string) => !filesModified.includes(f))]);
</script>

<div class="feed-item">
  <div class="feed-item-header">
    {#if item.item_type === 'observation'}
      <span class="badge {item.type || 'observation'}">{item.type || 'obs'}</span>
    {:else}
      <span class="badge summary">summary</span>
    {/if}
    <span class="project-name">{item.project}</span>
    <span class="timestamp">{formatTime(item.created_at)}</span>
  </div>

  {#if item.item_type === 'observation'}
    {#if item.title}
      <div class="title">{item.title}</div>
    {/if}
    {#if item.narrative}
      <div class="narrative">{item.narrative}</div>
    {/if}
    {#if facts.length > 0}
      <ul class="facts">
        {#each facts as fact}
          <li>{fact}</li>
        {/each}
      </ul>
    {/if}
    {#if allFiles.length > 0}
      <div class="files">
        {#each allFiles.slice(0, 6) as file}
          <span class="file-tag" title={file}>{file.split('/').pop()}</span>
        {/each}
        {#if allFiles.length > 6}
          <span class="file-tag">+{allFiles.length - 6}</span>
        {/if}
      </div>
    {/if}
  {:else}
    {#if item.request}
      <div class="title">{item.request}</div>
    {/if}
    <div class="summary-sections">
      {#if item.investigated}
        <div class="summary-section">
          <div class="section-label">Investigated</div>
          <div class="section-content">{item.investigated}</div>
        </div>
      {/if}
      {#if item.learned}
        <div class="summary-section">
          <div class="section-label">Learned</div>
          <div class="section-content">{item.learned}</div>
        </div>
      {/if}
      {#if item.completed}
        <div class="summary-section">
          <div class="section-label">Completed</div>
          <div class="section-content">{item.completed}</div>
        </div>
      {/if}
      {#if item.next_steps}
        <div class="summary-section">
          <div class="section-label">Next Steps</div>
          <div class="section-content">{item.next_steps}</div>
        </div>
      {/if}
    </div>
  {/if}
</div>
