<script lang="ts">
  import { getSettingsData, updateSettings, type SettingsData } from '../api';

  let settings: SettingsData | null = $state(null);
  let loading = $state(true);
  let saving = $state(false);
  let message = $state('');
  let messageType: 'success' | 'error' = $state('success');

  async function load() {
    loading = true;
    try {
      settings = await getSettingsData();
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (!settings) return;
    saving = true;
    message = '';
    try {
      settings = await updateSettings(settings);
      message = 'Settings saved. Some changes may require a worker restart.';
      messageType = 'success';
    } catch (err) {
      message = 'Failed to save settings';
      messageType = 'error';
      console.error(err);
    } finally {
      saving = false;
      setTimeout(() => message = '', 4000);
    }
  }

  load();
</script>

{#if loading}
  <div class="loading"><span class="loading-pulse">Loading settings...</span></div>
{:else if settings}
  <div class="settings-form">
    <div class="settings-section">
      <h3>Context Injection</h3>
      <p class="settings-desc">Controls what gets injected at the start of each session.</p>

      <label class="setting-field">
        <span class="setting-label">Observations in context</span>
        <span class="setting-hint">Number of recent observations shown in the activity table</span>
        <input type="number" bind:value={settings.OBSERVATION_COUNT} min="0" max="200" />
      </label>

      <label class="setting-field">
        <span class="setting-label">Full detail observations</span>
        <span class="setting-hint">How many of the most recent observations get full detail (facts, narrative, files)</span>
        <input type="number" bind:value={settings.FULL_OBSERVATION_COUNT} min="0" max="20" />
      </label>

      <label class="setting-field">
        <span class="setting-label">Session summaries</span>
        <span class="setting-hint">Number of recent session summaries to inject</span>
        <input type="number" bind:value={settings.SUMMARY_COUNT} min="0" max="20" />
      </label>
    </div>

    <div class="settings-section">
      <h3>Worker</h3>

      <label class="setting-field">
        <span class="setting-label">Port</span>
        <span class="setting-hint">Requires worker restart to take effect</span>
        <input type="number" bind:value={settings.WORKER_PORT} min="1024" max="65535" />
      </label>
    </div>

    <div class="settings-section">
      <h3>Embeddings (Ollama)</h3>
      <p class="settings-desc">Optional. Used for semantic search. Falls back to FTS5 if unavailable.</p>

      <label class="setting-field">
        <span class="setting-label">Ollama URL</span>
        <input type="text" bind:value={settings.OLLAMA_URL} />
      </label>

      <label class="setting-field">
        <span class="setting-label">Embedding model</span>
        <input type="text" bind:value={settings.OLLAMA_MODEL} />
      </label>
    </div>

    <div class="settings-actions">
      <button class="save-btn" onclick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
      {#if message}
        <span class="settings-message {messageType}">{message}</span>
      {/if}
    </div>
  </div>
{/if}
