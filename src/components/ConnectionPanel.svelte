<script lang="ts">
  import type { ConnectionStatus } from '../lib/types';
  import SearchableDropdown from './SearchableDropdown.svelte';

  let {
    status,
    wsUrl = $bindable(),
    onConnect,
    dexOptions,
    symbolOptions,
    selectedDex = $bindable(),
    selectedSymbol = $bindable(),
    loadingSymbols,
  }: {
    status: ConnectionStatus;
    wsUrl: string;
    onConnect: (coin: string, dex: string) => void;
    dexOptions: Array<{ value: string; label: string }>;
    symbolOptions: Array<{ value: string; label: string }>;
    selectedDex: string;
    selectedSymbol: string;
    loadingSymbols: boolean;
  } = $props();

  const statusColors: Record<ConnectionStatus, string> = {
    idle: '#525252',
    connecting: '#78a9ff',
    connected: '#78a9ff',
    subscribed: '#42be65',
    disconnected: '#525252',
    error: '#ee5396',
  };

  function handleConnect() {
    if (!selectedSymbol) return;
    onConnect(selectedSymbol, selectedDex);
  }
</script>

<div class="connection-panel">
  <div class="ws-section">
    <div class="section-label">Live stream</div>
    <input
      class="url-input"
      type="text"
      bind:value={wsUrl}
      placeholder="wss://..."
    />

    <div class="dropdowns">
      <div class="dropdown-field">
        <label class="field-label">DEX</label>
        <SearchableDropdown
          options={dexOptions}
          bind:value={selectedDex}
          placeholder="Select DEX"
        />
      </div>
      <div class="dropdown-field">
        <label class="field-label">Symbol</label>
        <SearchableDropdown
          options={symbolOptions}
          bind:value={selectedSymbol}
          placeholder={loadingSymbols ? 'Loading...' : 'Search symbol'}
          disabled={loadingSymbols}
        />
      </div>
    </div>

    <button
      class="connect-btn"
      onclick={handleConnect}
      disabled={!selectedSymbol || status === 'connecting' || status === 'connected'}
    >
      Connect
    </button>

    {#if status !== 'idle'}
      <div class="status-row">
        <span class="status-dot" style="background: {statusColors[status]}"></span>
        <span class="status-text">{status}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .connection-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    flex: 1;
  }

  .ws-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .section-label {
    font-size: 12px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .dropdowns {
    display: flex;
    gap: 12px;
  }

  .dropdown-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 200px;
  }

  .field-label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .url-input {
    width: 424px;
    padding: 8px 12px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: inherit;
    font-size: 11px;
    border-radius: 4px;
  }

  .url-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .url-input::placeholder {
    color: var(--text-dim);
  }

  .connect-btn {
    padding: 8px 20px;
    background: var(--accent);
    border: none;
    color: #000;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    border-radius: 4px;
    cursor: pointer;
    width: 424px;
  }

  .connect-btn:hover {
    opacity: 0.9;
  }

  .connect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-text {
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
