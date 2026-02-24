<script lang="ts">
  import type { SnapshotView, ParseMetrics, StreamMetrics, ConnectionStatus, TrackedAddress } from './lib/types';
  import { createBookWorkerClient } from './lib/bookWorkerClient';
  import { createPositionTracker, type PositionInfo } from './lib/positionTracker';
  import { fetchDexes, fetchSymbols, type DexInfo, type SymbolInfo } from './lib/hyperliquidApi';
  import ConnectionPanel from './components/ConnectionPanel.svelte';
  import SearchableDropdown from './components/SearchableDropdown.svelte';
  import OrderBook from './components/OrderBook.svelte';
  import Controls from './components/Controls.svelte';
  import Metrics from './components/Metrics.svelte';
  import AddressTracker from './components/AddressTracker.svelte';
  import { onDestroy, onMount } from 'svelte';

  const DEFAULT_WS_URL = 'wss://api.hyperliquid.xyz/ws';
  const WS_URL_KEY = 'l4book-ws-url';
  let wsUrl = $state(localStorage.getItem(WS_URL_KEY) || DEFAULT_WS_URL);

  $effect(() => {
    localStorage.setItem(WS_URL_KEY, wsUrl);
  });

  let snapshot: SnapshotView | null = $state(null);
  let parseMetrics: ParseMetrics | null = $state(null);
  let streamMetrics: StreamMetrics | null = $state(null);
  let error: string | null = $state(null);
  let loading = $state(false);
  let connectionStatus: ConnectionStatus = $state('idle');
  let mode: 'idle' | 'file' | 'stream' = $state('idle');
  let paused = $state(false);
  let consecutiveFailures = $state(0);

  const STORAGE_KEY = 'l4book-tracked-addresses';

  function loadSavedAddresses(): TrackedAddress[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return [];
  }

  let trackedAddresses: TrackedAddress[] = $state(loadSavedAddresses());

  $effect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trackedAddresses));
  });
  let tickSize = $state(1);
  let baseTickSize = $state(1);
  let rebuildIntervalMs = $state(100);

  $effect(() => {
    client.setRebuildInterval(rebuildIntervalMs);
  });

  // --- Shared DEX / symbol state ---
  let dexes: DexInfo[] = $state([]);
  let symbols: SymbolInfo[] = $state([]);
  let loadingSymbols = $state(false);
  let selectedDex = $state('');
  let selectedSymbol = $state('');

  let dexOptions = $derived([
    { value: '', label: '(Native)' },
    ...dexes.map((d) => ({ value: d.name, label: d.name })),
  ]);

  let symbolOptions = $derived(
    symbols.map((s) => ({ value: s.name, label: s.name })),
  );

  async function loadSymbols(dex: string) {
    loadingSymbols = true;
    selectedSymbol = '';
    try {
      symbols = await fetchSymbols(dex);
    } catch {
      symbols = [];
    }
    loadingSymbols = false;
  }

  onMount(async () => {
    try {
      dexes = await fetchDexes();
    } catch {}
    await loadSymbols('');
  });

  // Reload symbols when DEX selection changes
  let prevSelectedDex: string | undefined = undefined;
  $effect(() => {
    if (prevSelectedDex !== undefined && selectedDex !== prevSelectedDex) {
      loadSymbols(selectedDex);
    }
    prevSelectedDex = selectedDex;
  });

  // Cache of szDecimals per coin from Hyperliquid meta API
  // Keys use "dex:coin" for HIP-3, plain "coin" for native
  let szDecimalsCache: Map<string, number> = new Map();

  function cacheKey(coin: string, dex: string): string {
    return dex ? `${dex}:${coin}` : coin;
  }

  async function fetchSzDecimals(coin: string, dex: string = ''): Promise<number | null> {
    const key = cacheKey(coin, dex);
    if (szDecimalsCache.has(key)) return szDecimalsCache.get(key)!;
    try {
      const body: Record<string, string> = { type: 'meta' };
      if (dex) body.dex = dex;
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const universe: { name: string; szDecimals: number }[] = data.universe ?? [];
      const prefix = dex ? `${dex}:` : '';
      for (const asset of universe) {
        // HIP-3 names come back as "dex:SYMBOL" — strip prefix for cache key
        const bare = prefix && asset.name.startsWith(prefix)
          ? asset.name.slice(prefix.length)
          : asset.name;
        szDecimalsCache.set(cacheKey(bare, dex), asset.szDecimals);
      }
      return szDecimalsCache.get(key) ?? null;
    } catch {
      return null;
    }
  }

  // Compute tick size from szDecimals and current price.
  // Rules: up to 5 significant figures, up to (6 - szDecimals) decimal places,
  // integers always valid. Tick = max of both constraints.
  function computeTickSize(szDecimals: number, price: number): number {
    const maxDecimals = 6 - szDecimals;
    const decimalTick = Math.pow(10, -maxDecimals);
    if (price <= 0) return decimalTick;
    // 5th significant figure position
    let sigFigTick = Math.pow(10, Math.floor(Math.log10(price)) - 4);
    // Integers are always valid, so sig-fig tick can't exceed 1
    if (sigFigTick > 1) sigFigTick = 1;
    return Math.max(sigFigTick, decimalTick);
  }

  async function applyApiTickSize(coin: string, dex: string = '', price?: number) {
    const sz = await fetchSzDecimals(coin, dex);
    if (sz != null) {
      const midPrice = price ?? getMidPrice();
      const apiTick = computeTickSize(sz, midPrice);
      baseTickSize = apiTick;
      tickSize = apiTick;
    }
  }

  function snapshotMidPrice(snap: SnapshotView): number {
    const bids = snap.bids.prices;
    const asks = snap.asks.prices;
    const bestBid = bids.length > 0 ? bids[0] : 0;
    const bestAsk = asks.length > 0 ? asks[0] : 0;
    if (bestBid && bestAsk) return (bestBid + bestAsk) / 2;
    return bestBid || bestAsk || 0;
  }

  function getMidPrice(): number {
    return snapshot ? snapshotMidPrice(snapshot) : 0;
  }

  function applyTickFromSnapshot(data: SnapshotView) {
    const key = cacheKey(data.meta.coin, activeDex);
    const sz = szDecimalsCache.get(key);
    if (sz != null) {
      const mid = snapshotMidPrice(data);
      const apiTick = computeTickSize(sz, mid);
      baseTickSize = apiTick;
      tickSize = apiTick;
    } else {
      baseTickSize = data.heatmap.tickSize;
      tickSize = data.heatmap.tickSize;
    }
  }

  let orderBookRef: OrderBook | undefined = $state(undefined);
  let isFirstSnapshot = true;

  let positions: Map<string, PositionInfo | null> = $state(new Map());

  const positionTracker = createPositionTracker((address, position) => {
    positions = new Map(positions).set(address, position);
  });

  // Sync tracked addresses with position tracker
  let prevAddresses = new Set<string>();
  $effect(() => {
    const current = new Set(trackedAddresses.map((t) => t.address));
    for (const addr of current) {
      if (!prevAddresses.has(addr)) positionTracker.subscribe(addr);
    }
    for (const addr of prevAddresses) {
      if (!current.has(addr)) {
        positionTracker.unsubscribe(addr);
        const next = new Map(positions);
        next.delete(addr);
        positions = next;
      }
    }
    prevAddresses = current;
  });

  // Update coin when snapshot changes
  $effect(() => {
    if (snapshot?.meta.coin) {
      positionTracker.setCoin(snapshot.meta.coin);
    }
  });

  onDestroy(() => positionTracker.destroy());

  const client = createBookWorkerClient({
    onStatus(status, message) {
      connectionStatus = status;
      if (status === 'error' || status === 'disconnected') {
        consecutiveFailures++;
        if (consecutiveFailures > 2 && message) {
          error = `Connection failed (${consecutiveFailures} attempts): ${message}`;
        }
      } else if (status === 'subscribed') {
        consecutiveFailures = 0;
      }
    },
    onSnapshot(data, metrics) {
      snapshot = data;
      streamMetrics = metrics;
      parseMetrics = null;
      applyTickFromSnapshot(data);
      loading = false;
      mode = 'stream';
      error = null;
      consecutiveFailures = 0;
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        queueMicrotask(() => orderBookRef?.resetView());
      }
    },
    onUpdate(data, metrics) {
      if (paused) return;
      snapshot = data;
      streamMetrics = metrics;
    },
    onFileResult(data, metrics) {
      snapshot = data;
      parseMetrics = metrics;
      streamMetrics = null;
      // Parse dex:symbol from snapshot coin
      const metaCoin = data.meta.coin;
      const colonIdx = metaCoin.indexOf(':');
      let fileDex = '';
      let fileCoin = metaCoin;
      if (colonIdx !== -1) {
        fileDex = metaCoin.slice(0, colonIdx);
        fileCoin = metaCoin.slice(colonIdx + 1);
      }
      activeDex = fileDex;
      activeCoin = fileCoin;
      applyTickFromSnapshot(data);
      const key = cacheKey(fileCoin, fileDex);
      if (!szDecimalsCache.has(key)) {
        applyApiTickSize(fileCoin, fileDex, snapshotMidPrice(data));
      }
      loading = false;
      mode = 'file';
      error = null;
    },
    onFileError(msg) {
      error = msg;
      loading = false;
    },
  });

  let activeCoin = $state('');
  let activeDex = $state('');

  function handleConnect(coin: string, dex: string = '') {
    loading = true;
    error = null;
    consecutiveFailures = 0;
    snapshot = null;
    parseMetrics = null;
    streamMetrics = null;
    isFirstSnapshot = true;
    activeCoin = coin;
    activeDex = dex;
    // Keep dropdown state in sync
    selectedDex = dex;
    selectedSymbol = coin;
    paused = false;
    const wireCoin = dex ? `${dex}:${coin}` : coin;
    client.connect(wsUrl, wireCoin);
    applyApiTickSize(coin, dex);
  }

  // Called from header symbol dropdown when user picks a new symbol while streaming
  function handleHeaderSymbolChange(symbol: string) {
    if (!symbol || (symbol === activeCoin && selectedDex === activeDex)) return;
    handleConnect(symbol, selectedDex);
  }

  function handleDisconnect() {
    client.disconnect();
    connectionStatus = 'idle';
    snapshot = null;
    streamMetrics = null;
    mode = 'idle';
  }


  function handleReset() {
    if (mode === 'stream') {
      handleDisconnect();
    } else {
      snapshot = null;
      parseMetrics = null;
      mode = 'idle';
    }
  }

  function resetView() {
    orderBookRef?.resetView();
  }

  function zoomSpread() {
    orderBookRef?.zoomSpread();
  }
</script>

<div class="app">
  <header class="header">
    <h1>L4 Book Visualizer</h1>
    {#if snapshot}
      <span class="meta">
        {#if mode === 'stream'}
          <span class="header-dropdowns">
            <SearchableDropdown
              options={dexOptions}
              bind:value={selectedDex}
              placeholder="DEX"
              compact
            />
            <span class="header-sep">/</span>
            <SearchableDropdown
              options={symbolOptions}
              bind:value={selectedSymbol}
              placeholder={loadingSymbols ? '...' : 'Symbol'}
              disabled={loadingSymbols}
              compact
              onSelect={handleHeaderSymbolChange}
            />
          </span> &middot;
        {:else}
          {snapshot.meta.coin} &middot;
        {/if}
        height {snapshot.meta.height.toLocaleString()} &middot;
        {new Date(snapshot.meta.time).toISOString()}
        {#if mode === 'stream'}
          &middot;
          {#if paused}
            <span class="paused-badge">PAUSED</span>
          {:else}
            <span class="live-badge">LIVE</span>
          {/if}
          <button class="pause-btn" onclick={() => paused = !paused}>
            {paused ? 'Resume' : 'Pause'}
          </button>
        {/if}
      </span>
    {/if}
  </header>

  {#if !snapshot && !loading}
    <ConnectionPanel
      status={connectionStatus}
      bind:wsUrl
      onConnect={handleConnect}
      {dexOptions}
      {symbolOptions}
      bind:selectedDex
      bind:selectedSymbol
      {loadingSymbols}
    />
  {/if}

  {#if loading && !snapshot}
    <div class="loading">
      {#if connectionStatus === 'connecting' || connectionStatus === 'connected' || connectionStatus === 'subscribed'}
        Connecting to stream...
      {:else if error}
        <div class="retry-error">
          <div class="error-msg">{error}</div>
          <div class="retry-note">Retrying...</div>
        </div>
      {:else}
        Parsing snapshot...
      {/if}
    </div>
  {/if}

  {#if error && !snapshot && !loading}
    <div class="error">{error}</div>
  {/if}

  {#if snapshot}
    <div class="main-content">
      <div class="sidebar">
        <Controls onResetView={resetView} onZoomSpread={zoomSpread} bind:tickSize {baseTickSize} bind:rebuildIntervalMs isStreaming={mode === 'stream'} />
        <AddressTracker bind:trackedAddresses coin={snapshot.meta.coin} {positions} szDecimals={szDecimalsCache.get(cacheKey(activeCoin, activeDex)) ?? 4} />
        {#if parseMetrics}
          <Metrics metrics={parseMetrics} />
        {/if}
        {#if streamMetrics}
          <Metrics streamMetrics={streamMetrics} />
        {/if}
        <button class="reset-btn" onclick={handleReset}>
          {mode === 'stream' ? 'Disconnect' : 'Load different file'}
        </button>
      </div>
      <div class="book-area">
        <OrderBook bind:this={orderBookRef} {snapshot} {trackedAddresses} {tickSize} />
      </div>
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .header h1 {
    font-size: 15px;
    font-weight: 600;
    color: var(--accent);
  }

  .meta {
    font-size: 12px;
    color: var(--text-dim);
  }

  .header-dropdowns {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
    vertical-align: baseline;
  }

  .header-sep {
    color: var(--text-dim);
    font-size: 12px;
  }

  .live-badge {
    color: #42be65;
    font-weight: 600;
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  .paused-badge {
    color: var(--accent);
    font-weight: 600;
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  .pause-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: inherit;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    margin-left: 4px;
  }

  .pause-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .reset-btn {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-dim);
    padding: 8px 16px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    border-radius: 4px;
    width: 100%;
    margin-top: 12px;
  }

  .reset-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-dim);
    font-size: 14px;
  }

  .error {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--red);
    font-size: 14px;
  }

  .retry-error {
    text-align: center;
  }

  .error-msg {
    color: var(--red);
    font-size: 14px;
  }

  .retry-note {
    color: var(--text-dim);
    font-size: 12px;
    margin-top: 4px;
  }

  .main-content {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .sidebar {
    width: 240px;
    flex-shrink: 0;
    padding: 16px;
    border-right: 1px solid var(--border);
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }

  .book-area {
    flex: 1;
    min-width: 0;
  }
</style>
