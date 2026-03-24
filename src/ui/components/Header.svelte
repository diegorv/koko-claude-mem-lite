<script lang="ts">
  let { onsearch }: { onsearch: (q: string) => void } = $props();
  let query = $state('');

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') onsearch(query);
  }
</script>

<div class="header">
  <h1><span class="dot"></span> memory-lite</h1>
  <input
    type="text"
    placeholder="Search observations..."
    bind:value={query}
    onkeydown={onKeydown}
    style="width: 280px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); padding: 6px 10px; font-family: var(--font); font-size: 12px;"
  />
</div>
