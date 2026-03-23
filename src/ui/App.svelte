<script lang="ts">
  import { getStats, getProjects, type Stats, type Project } from './api';
  import Header from './components/Header.svelte';
  import StatsBar from './components/StatsBar.svelte';
  import FeedView from './components/FeedView.svelte';
  import SessionsView from './components/SessionsView.svelte';
  import SearchView from './components/SearchView.svelte';

  let stats: Stats | null = $state(null);
  let projects: Project[] = $state([]);
  let selectedProject: string = $state('');
  let activeTab: 'feed' | 'sessions' | 'search' = $state('feed');
  let searchQuery = $state('');

  async function init() {
    const [s, p] = await Promise.all([getStats(), getProjects()]);
    stats = s;
    projects = p.projects;
  }

  init();

  function handleSearch(q: string) {
    searchQuery = q;
    if (q) activeTab = 'search';
  }
</script>

<div class="app">
  <Header onsearch={handleSearch} />

  {#if stats}
    <StatsBar {stats} />
  {/if}

  <div class="controls">
    <div class="tab-bar">
      <button class:active={activeTab === 'feed'} onclick={() => activeTab = 'feed'}>Feed</button>
      <button class:active={activeTab === 'sessions'} onclick={() => activeTab = 'sessions'}>Sessions</button>
      <button class:active={activeTab === 'search'} onclick={() => activeTab = 'search'}>Search</button>
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
  {/if}
</div>
