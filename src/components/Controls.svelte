<script lang="ts">
  let { onResetView, onZoomSpread, tickSize = $bindable(), baseTickSize, rebuildIntervalMs = $bindable(), isStreaming = false }: {
    onResetView: () => void;
    onZoomSpread: () => void;
    tickSize: number;
    baseTickSize: number;
    rebuildIntervalMs: number;
    isStreaming?: boolean;
  } = $props();

  let inputValue = $state(String(tickSize));
  let rebuildInput = $state(String(rebuildIntervalMs));

  // Sync tick input when tickSize changes externally (e.g. new snapshot / API fetch)
  let lastTickSize = tickSize;
  $effect(() => {
    if (tickSize !== lastTickSize) {
      inputValue = String(tickSize);
      lastTickSize = tickSize;
    }
  });

  function applyTickSize() {
    const val = parseFloat(inputValue);
    if (isNaN(val) || val < baseTickSize) {
      inputValue = String(tickSize);
      return;
    }
    // Snap to nearest multiple of base tick size
    const snapped = Math.round(val / baseTickSize) * baseTickSize;
    const rounded = Math.round(snapped * 1e8) / 1e8;
    tickSize = Math.max(rounded, baseTickSize);
    inputValue = String(tickSize);
  }

  function applyRebuildInterval() {
    const val = parseInt(rebuildInput);
    if (isNaN(val) || val < 1) {
      rebuildInput = String(rebuildIntervalMs);
      return;
    }
    rebuildIntervalMs = val;
    rebuildInput = String(rebuildIntervalMs);
  }

  function handleTickKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') applyTickSize();
  }

  function handleRebuildKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') applyRebuildInterval();
  }
</script>

<div class="controls">
  <div class="control-group">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label>View</label>
    <div class="btn-row">
      <button class="action-btn" onclick={onResetView}>Reset View</button>
      <button class="action-btn" onclick={onZoomSpread}>Zoom Spread</button>
    </div>
  </div>
  <div class="control-group">
    <label for="tick-size-input">Tick Size (base: {baseTickSize})</label>
    <input
      id="tick-size-input"
      type="text"
      bind:value={inputValue}
      onkeydown={handleTickKeydown}
      onblur={applyTickSize}
      class="tick-input"
    />
  </div>
  {#if isStreaming}
    <div class="control-group">
      <label for="rebuild-input" class="has-tooltip">Rebuild Rate (ms)
        <span class="tooltip">How often the heatmap is rebuilt from accumulated diffs (lower = smoother but more CPU)</span>
      </label>
      <input
        id="rebuild-input"
        type="text"
        bind:value={rebuildInput}
        onkeydown={handleRebuildKeydown}
        onblur={applyRebuildInterval}
        class="tick-input"
      />
    </div>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .btn-row {
    display: flex;
    gap: 6px;
  }

  .action-btn {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    padding: 6px 10px;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.1s;
  }

  .action-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .has-tooltip {
    position: relative;
    cursor: help;
  }

  .tooltip {
    display: none;
    position: absolute;
    left: 0;
    top: 100%;
    margin-top: 4px;
    background: var(--border);
    color: var(--text);
    font-size: 10px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    padding: 6px 8px;
    border-radius: 4px;
    width: 200px;
    line-height: 1.4;
    z-index: 10;
    white-space: normal;
  }

  .has-tooltip:hover .tooltip {
    display: block;
  }

  .tick-input {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 4px 8px;
    font-family: inherit;
    font-size: 11px;
    border-radius: 3px;
    width: 100%;
    box-sizing: border-box;
  }
</style>
