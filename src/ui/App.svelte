<script lang="ts">
  import { getStats, getProjects, type Stats, type Project } from './api';
  import Header from './components/Header.svelte';
  import StatsBar from './components/StatsBar.svelte';
  import FeedView from './components/FeedView.svelte';
  import SessionsView from './components/SessionsView.svelte';
  import SearchView from './components/SearchView.svelte';
  import ContextView from './components/ContextView.svelte';
  import SettingsView from './components/SettingsView.svelte';

  let stats: Stats | null = $state(null);
  let projects: Project[] = $state([]);
  let selectedProject: string = $state('');
  let activeTab: 'feed' | 'sessions' | 'search' | 'context' | 'settings' = $state('feed');
  let searchQuery = $state('');
  let initError: string | null = $state(null);
  let runtimeError: string | null = $state(null);

  async function init() {
    try {
      const [s, p] = await Promise.all([getStats(), getProjects()]);
      stats = s;
      projects = p.projects;
    } catch (err) {
      initError = err instanceof Error ? err.message : 'Failed to connect to worker';
    }
  }

  init();

  // Global error boundary for unhandled errors
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      runtimeError = e.message || 'An unexpected error occurred';
    });
    window.addEventListener('unhandledrejection', (e) => {
      runtimeError = e.reason?.message || 'An unexpected error occurred';
    });
  }

  function handleSearch(q: string) {
    searchQuery = q;
    if (q) activeTab = 'search';
  }
</script>

<div class="app">
  <Header onsearch={handleSearch} />

  {#if runtimeError}
    <div style="padding: 12px; background: var(--bg-surface); border: 1px solid #c53030; border-radius: var(--radius-sm); color: var(--text-dim); margin: 8px 0; font-size: 12px;">
      Error: {runtimeError}
      <button onclick={() => { runtimeError = null; }} style="margin-left: 8px; font-size: 11px; cursor: pointer; background: none; border: 1px solid var(--border); border-radius: 3px; color: var(--text-dim); padding: 2px 6px;">Dismiss</button>
    </div>
  {/if}

  {#if initError}
    <div style="padding: 12px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-dim); margin: 8px 0; font-size: 12px;">
      Failed to load: {initError}
      <button onclick={() => { initError = null; init(); }} style="margin-left: 8px; font-size: 11px; cursor: pointer; background: none; border: 1px solid var(--border); border-radius: 3px; color: var(--text-dim); padding: 2px 6px;">Retry</button>
    </div>
  {:else if stats}
    <StatsBar {stats} />
  {/if}

  <div class="controls">
    <div class="tab-bar">
      <button class:active={activeTab === 'feed'} onclick={() => activeTab = 'feed'}>Feed</button>
      <button class:active={activeTab === 'sessions'} onclick={() => activeTab = 'sessions'}>Sessions</button>
      <button class:active={activeTab === 'search'} onclick={() => activeTab = 'search'}>Search</button>
      <button class:active={activeTab === 'context'} onclick={() => activeTab = 'context'}>Context</button>
      <button class:active={activeTab === 'settings'} onclick={() => activeTab = 'settings'}>Settings</button>
    </div>

    <select bind:value={selectedProject}>
      <option value="">All projects</option>
      {#each projects as p}
        <option value={p.project}>{p.project} ({p.session_count})</option>
      {/each}
    </select>
  </div>

  {#if activeTab === 'feed'}
    <FeedView project={selectedProject} />
  {:else if activeTab === 'sessions'}
    <SessionsView project={selectedProject} />
  {:else if activeTab === 'search'}
    <SearchView project={selectedProject} query={searchQuery} />
  {:else if activeTab === 'context'}
    <ContextView project={selectedProject} />
  {:else if activeTab === 'settings'}
    <SettingsView />
  {/if}
</div>
