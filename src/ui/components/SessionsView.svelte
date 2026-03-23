<script lang="ts">
  import { getSessions, getSessionObservations, type Session, type Observation } from '../api';
  import FeedItemComponent from './FeedItem.svelte';

  let { project = '' }: { project?: string } = $props();

  let sessions: Session[] = $state([]);
  let total = $state(0);
  let loading = $state(true);
  let selectedSession: Session | null = $state(null);
  let observations: Observation[] = $state([]);
  let loadingObs = $state(false);

  async function loadSessions() {
    loading = true;
    const result = await getSessions(project || undefined);
    sessions = result.sessions;
    total = result.total;
    loading = false;
  }

  async function selectSession(session: Session) {
    selectedSession = session;
    loadingObs = true;
    const result = await getSessionObservations(session.id);
    observations = result.observations;
    loadingObs = false;
  }

  function goBack() {
    selectedSession = null;
    observations = [];
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleString('en', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function parseSummary(s: string | null): any {
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      if (parsed.request === null && parsed.investigated === null && parsed.learned === null && parsed.completed === null) return null;
      return parsed;
    } catch { return null; }
  }

  $effect(() => {
    void project;
    selectedSession = null;
    loadSessions();
  });
</script>

{#if selectedSession}
  {@const sum = parseSummary(selectedSession.summary)}
  <div class="session-detail">
    <button class="back" onclick={goBack}>&larr; Back to sessions</button>

    <div class="session-info">
      <h2>
        {#if selectedSession.user_prompt}
          {selectedSession.user_prompt}
        {:else}
          Session #{selectedSession.id}
        {/if}
      </h2>
      <div class="meta">
        <span>{selectedSession.project}</span>
        <span>{formatTime(selectedSession.created_at)}</span>
        <span>{selectedSession.status}</span>
        <span>{selectedSession.observation_count} observations</span>
      </div>

      {#if sum}
        <div class="summary-sections" style="margin-top: 12px;">
          {#if sum.investigated}
            <div class="summary-section">
              <div class="section-label">Investigated</div>
              <div class="section-content">{sum.investigated}</div>
            </div>
          {/if}
          {#if sum.learned}
            <div class="summary-section">
              <div class="section-label">Learned</div>
              <div class="section-content">{sum.learned}</div>
            </div>
          {/if}
          {#if sum.completed}
            <div class="summary-section">
              <div class="section-label">Completed</div>
              <div class="section-content">{sum.completed}</div>
            </div>
          {/if}
          {#if sum.next_steps}
            <div class="summary-section">
              <div class="section-label">Next Steps</div>
              <div class="section-content">{sum.next_steps}</div>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if loadingObs}
      <div class="loading"><span class="loading-pulse">Loading observations...</span></div>
    {:else}
      <div class="feed">
        {#each observations as obs}
          <FeedItemComponent item={{ ...obs, item_type: 'observation' }} />
        {/each}
        {#if observations.length === 0}
          <div class="empty">No observations for this session.</div>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  {#if loading}
    <div class="loading"><span class="loading-pulse">Loading sessions...</span></div>
  {:else if sessions.length === 0}
    <div class="empty">
      <div class="icon">~</div>
      <div>No sessions yet.</div>
    </div>
  {:else}
    <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 8px;">{total} sessions</div>
    <div class="session-list">
      {#each sessions as session}
        <button class="session-row" onclick={() => selectSession(session)}>
          <span class="session-id">#{session.id}</span>
          <span class="status-dot {session.status}"></span>
          <span class="session-prompt">
            {session.user_prompt || 'No prompt recorded'}
          </span>
          <div class="session-meta">
            <span class="obs-count">{session.observation_count} obs</span>
            <span>{formatTime(session.created_at)}</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
{/if}
