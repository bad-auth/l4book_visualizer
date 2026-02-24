<script lang="ts">
  import type { SnapshotView, ViewRange, TrackedAddress } from '../lib/types';
  import { computeVisibleStats } from '../lib/visibleStats';
  import { regroupHeatmap } from '../lib/regroupHeatmap';
  import Heatmap from './Heatmap.svelte';
  import DepthChart from './DepthChart.svelte';

  let { snapshot, trackedAddresses = [], tickSize = 1 }: {
    snapshot: SnapshotView;
    trackedAddresses?: TrackedAddress[];
    tickSize?: number;
  } = $props();

  let heatmapData = $derived(regroupHeatmap(snapshot.heatmap, tickSize));

  // Throttled snapshot for spread bar and depth chart (~4fps)
  let throttledSnapshot: SnapshotView = $state(snapshot);
  let lastThrottleTime = 0;

  $effect(() => {
    const s = snapshot;
    const now = performance.now();
    if (now - lastThrottleTime >= 250) {
      throttledSnapshot = s;
      lastThrottleTime = now;
    }
  });

  // Compute best bid/ask/mid from throttled data (4fps, not full rate)
  let bestBid = $derived(throttledSnapshot.bids.prices.length > 0 ? throttledSnapshot.bids.prices[0] : 0);
  let bestAsk = $derived(throttledSnapshot.asks.prices.length > 0 ? throttledSnapshot.asks.prices[0] : 0);
  let mid = $derived(bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0);
  let spread = $derived(bestAsk - bestBid);
  let spreadBps = $derived(mid > 0 ? (spread / mid) * 10000 : 0);

  function makeRange(priceMin: number, priceMax: number): ViewRange {
    const stats = computeVisibleStats(heatmapData, priceMin, priceMax);
    return {
      priceMin,
      priceMax,
      yMin: 0,
      yMax: Math.max(stats.maxCumSize * 1.1, 0.001),
    };
  }

  // Default view: +-200 bps from mid
  function defaultRange(): ViewRange {
    const bps200 = mid * 200 / 10000;
    return makeRange(mid - bps200, mid + bps200);
  }

  let range: ViewRange = $state(defaultRange());

  // Only reset range when tick grouping changes (user changed tickSize),
  // not on every streaming update which would reset pan/zoom 20x/sec.
  let lastTickSize: number | undefined = undefined;
  $effect(() => {
    const ts = tickSize;
    if (lastTickSize !== undefined && ts !== lastTickSize) {
      range = defaultRange();
    }
    lastTickSize = ts;
  });

  export function resetView() {
    range = defaultRange();
  }

  export function zoomSpread() {
    // Zoom to +-50 bps from mid
    const bps50 = mid * 50 / 10000;
    range = makeRange(mid - bps50, mid + bps50);
  }
</script>

<div class="orderbook">
  <div class="spread-bar">
    <span>Mid: ${mid.toFixed(1)}</span>
    <span>Spread: ${spread.toFixed(2)} ({spreadBps.toFixed(1)} bps)</span>
    <span>Best Bid: ${bestBid.toFixed(1)}</span>
    <span>Best Ask: ${bestAsk.toFixed(1)}</span>
  </div>
  <div class="heatmap-area">
    <Heatmap data={heatmapData} bind:range {trackedAddresses} />
  </div>
  <div class="depth-area">
    <DepthChart
      bids={throttledSnapshot.bids}
      asks={throttledSnapshot.asks}
      priceMin={range.priceMin}
      priceMax={range.priceMax}
    />
  </div>
</div>

<style>
  .orderbook {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .spread-bar {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 0 16px;
    height: 28px;
    font-size: 11px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .heatmap-area {
    flex: 1;
    min-height: 0;
  }

  .depth-area {
    flex-shrink: 0;
  }
</style>
