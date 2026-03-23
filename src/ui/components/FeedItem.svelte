<script lang="ts">
  import type { FeedItem } from '../api';
  let { item }: { item: FeedItem } = $props();

  let viewMode: 'narrative' | 'facts' = $state('narrative');

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
</script>

<div class="feed-item">
  <div class="feed-item-header">
    {#if item.item_type === 'observation'}
      <span class="badge {item.type || 'observation'}">{item.type || 'obs'}</span>
    {:else}
      <span class="badge summary">summary</span>
    {/if}
    <span class="project-name">{item.project}</span>
    <span class="item-id">#{item.id}</span>
    <span class="timestamp">{formatTime(item.created_at)}</span>
  </div>

  {#if item.item_type === 'observation'}
    {#if item.title}
      <div class="title">{item.title}</div>
    {/if}

    {#if item.narrative || facts.length > 0}
      <div class="view-toggle">
        {#if item.narrative}
          <button class:active={viewMode === 'narrative'} onclick={() => viewMode = 'narrative'}>Narrative</button>
        {/if}
        {#if facts.length > 0}
          <button class:active={viewMode === 'facts'} onclick={() => viewMode = 'facts'}>Facts ({facts.length})</button>
        {/if}
      </div>
    {/if}

    {#if viewMode === 'narrative' && item.narrative}
      <div class="narrative">{item.narrative}</div>
    {:else if viewMode === 'facts' && facts.length > 0}
      <ul class="facts">
        {#each facts as fact}
          <li>{fact}</li>
        {/each}
      </ul>
    {/if}

    {#if filesModified.length > 0}
      <div class="file-group">
        <span class="file-group-label modified">modified</span>
        <div class="files">
          {#each filesModified.slice(0, 5) as file}
            <span class="file-tag modified" title={file}>{file.split('/').pop()}</span>
          {/each}
          {#if filesModified.length > 5}
            <span class="file-tag">+{filesModified.length - 5}</span>
          {/if}
        </div>
      </div>
    {/if}

    {#if filesRead.length > 0}
      <div class="file-group">
        <span class="file-group-label read">read</span>
        <div class="files">
          {#each filesRead.slice(0, 5) as file}
            <span class="file-tag" title={file}>{file.split('/').pop()}</span>
          {/each}
          {#if filesRead.length > 5}
            <span class="file-tag">+{filesRead.length - 5}</span>
          {/if}
        </div>
      </div>
    {/if}

  {:else}
    {#if item.request}
      <div class="title">{item.request}</div>
    {/if}
    <div class="summary-sections">
      {#if item.investigated}
        <div class="summary-section">
          <div class="section-label">&#128269; Investigated</div>
          <div class="section-content">{item.investigated}</div>
        </div>
      {/if}
      {#if item.learned}
        <div class="summary-section">
          <div class="section-label">&#128161; Learned</div>
          <div class="section-content">{item.learned}</div>
        </div>
      {/if}
      {#if item.completed}
        <div class="summary-section">
          <div class="section-label">&#9989; Completed</div>
          <div class="section-content">{item.completed}</div>
        </div>
      {/if}
      {#if item.next_steps}
        <div class="summary-section">
          <div class="section-label">&#10145; Next Steps</div>
          <div class="section-content">{item.next_steps}</div>
        </div>
      {/if}
    </div>
  {/if}
</div>
