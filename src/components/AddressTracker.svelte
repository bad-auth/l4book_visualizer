<script lang="ts">
  import type { TrackedAddress } from '../lib/types';
  import type { PositionInfo } from '../lib/positionTracker';

  let { trackedAddresses = $bindable(), coin = '', positions = new Map(), szDecimals = 4 }: {
    trackedAddresses: TrackedAddress[];
    coin?: string;
    positions?: Map<string, PositionInfo | null>;
    szDecimals?: number;
  } = $props();

  function fmt(n: number, decimals = 2): string {
    return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  const DEFAULT_PALETTE = [
    '#be95ff', '#78a9ff', '#ee5396', '#33b1ff',
    '#3ddbd9', '#ff7eb6', '#42be65', '#82cfff',
  ];

  let inputValue = $state('');
  let inputError = $state('');

  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

  function addAddress() {
    const trimmed = inputValue.trim();
    if (!ADDRESS_RE.test(trimmed)) {
      inputError = 'Invalid address (need 0x + 40 hex chars)';
      return;
    }
    // Case-insensitive dedup
    if (trackedAddresses.some((t) => t.address.toLowerCase() === trimmed.toLowerCase())) {
      inputError = 'Address already tracked';
      return;
    }
    const color = DEFAULT_PALETTE[trackedAddresses.length % DEFAULT_PALETTE.length];
    trackedAddresses = [...trackedAddresses, { address: trimmed, color }];
    inputValue = '';
    inputError = '';
  }

  function removeAddress(index: number) {
    trackedAddresses = trackedAddresses.filter((_, i) => i !== index);
  }

  function updateColor(index: number, newColor: string) {
    trackedAddresses = trackedAddresses.map((t, i) =>
      i === index ? { ...t, color: newColor } : t
    );
  }

  function updateLabel(index: number, label: string) {
    trackedAddresses = trackedAddresses.map((t, i) =>
      i === index ? { ...t, label: label || undefined } : t
    );
  }

  function truncate(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-2)}`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') addAddress();
  }
</script>

<div class="address-tracker">
  <div class="section-title">Track Addresses</div>
  <div class="input-row">
    <input
      type="text"
      placeholder="0x..."
      bind:value={inputValue}
      onkeydown={handleKeydown}
      class="addr-input"
    />
    <button class="add-btn" onclick={addAddress}>+</button>
  </div>
  {#if inputError}
    <div class="input-error">{inputError}</div>
  {/if}
  {#each trackedAddresses as tracked, i}
    {@const pos = positions.get(tracked.address) ?? null}
    <div class="tracked-card">
      <div class="tracked-header">
        <input
          type="color"
          value={tracked.color}
          oninput={(e) => updateColor(i, (e.target as HTMLInputElement).value)}
          class="color-picker"
        />
        <div class="addr-info">
          <input
            type="text"
            class="label-input"
            placeholder="Label..."
            value={tracked.label ?? ''}
            onchange={(e) => updateLabel(i, (e.target as HTMLInputElement).value.trim())}
          />
          <span class="addr-label" title={tracked.address}>{truncate(tracked.address)}</span>
        </div>
        <button class="remove-btn" onclick={() => removeAddress(i)}>x</button>
      </div>
      {#if coin && pos}
        <div class="pos-details" class:pos-long={pos.size > 0} class:pos-short={pos.size < 0}>
          <div class="pos-row">
            <span class="pos-label">size</span>
            <span class="pos-value side-color">{fmt(pos.size, szDecimals)}</span>
          </div>
          <div class="pos-row">
            <span class="pos-label">value</span>
            <span class="pos-value">${fmt(pos.positionValue)}</span>
          </div>
          <div class="pos-sep"></div>
          <div class="pos-row">
            <span class="pos-label">entry</span>
            <span class="pos-value">${fmt(pos.entryPx)}</span>
          </div>
          <div class="pos-row">
            <span class="pos-label">uPnL</span>
            <span class="pos-value pnl" class:pnl-pos={pos.unrealizedPnl > 0} class:pnl-neg={pos.unrealizedPnl < 0}
              >{pos.unrealizedPnl > 0 ? '+$' : pos.unrealizedPnl < 0 ? '-$' : '$'}{fmt(Math.abs(pos.unrealizedPnl))}</span>
          </div>
        </div>
      {:else if coin}
        <div class="pos-details no-pos">no position</div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .address-tracker {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    margin-bottom: 2px;
  }

  .input-row {
    display: flex;
    gap: 4px;
  }

  .addr-input {
    flex: 1;
    min-width: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 4px 6px;
    font-family: inherit;
    font-size: 11px;
    border-radius: 3px;
  }

  .addr-input::placeholder {
    color: var(--text-dim);
  }

  .add-btn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    width: 28px;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .add-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .input-error {
    font-size: 10px;
    color: var(--red);
  }

  .tracked-card {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px;
  }

  .tracked-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .color-picker {
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    background: none;
    flex-shrink: 0;
    -webkit-appearance: none;
    appearance: none;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-picker::-webkit-color-swatch {
    border: none;
    border-radius: 3px;
  }

  .color-picker::-moz-color-swatch {
    border: none;
    border-radius: 3px;
  }

  .addr-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .label-input {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    color: var(--text);
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 3px;
    margin: -1px -3px;
    width: calc(100% + 6px);
  }

  .label-input:hover {
    border-color: var(--border);
  }

  .label-input:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--bg);
  }

  .label-input::placeholder {
    color: var(--text-dim);
    font-weight: 400;
    opacity: 0.5;
  }

  .addr-label {
    font-size: 10px;
    font-family: monospace;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: 3px;
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
    line-height: 1;
    flex-shrink: 0;
  }

  .remove-btn:hover {
    color: var(--red);
  }

  .pos-details {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .pos-details.no-pos {
    font-size: 10px;
    color: var(--text-dim);
    opacity: 0.6;
  }

  .pos-details.pos-long {
    border-top-color: rgba(0, 200, 83, 0.3);
  }

  .pos-details.pos-short {
    border-top-color: rgba(255, 82, 82, 0.3);
  }

  .pos-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .pos-label {
    font-size: 9px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .pos-value {
    font-size: 11px;
    font-family: monospace;
    color: var(--text);
  }

  .pos-long .side-color { color: #00c853; }
  .pos-short .side-color { color: #ff5252; }

  .pos-sep {
    height: 1px;
    background: var(--border);
    margin: 2px 0;
  }

  .pnl-pos { color: #00c853; }
  .pnl-neg { color: #ff5252; }
</style>
