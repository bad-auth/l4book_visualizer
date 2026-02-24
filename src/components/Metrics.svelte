<script lang="ts">
  import type { ParseMetrics, StreamMetrics } from '../lib/types';

  let { metrics, streamMetrics }: {
    metrics?: ParseMetrics;
    streamMetrics?: StreamMetrics;
  } = $props();
</script>

<div class="metrics">
  <div class="metric-title">Performance</div>

  {#if metrics}
    <div class="metric-row">
      <span class="metric-label">File size</span>
      <span class="metric-value">{metrics.fileSizeMB.toFixed(1)} MB</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">JSON parse</span>
      <span class="metric-value">{metrics.parseTimeMs.toFixed(1)} ms</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Transform</span>
      <span class="metric-value">{metrics.transformTimeMs.toFixed(1)} ms</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Bid levels</span>
      <span class="metric-value">{metrics.bidCount.toLocaleString()}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Ask levels</span>
      <span class="metric-value">{metrics.askCount.toLocaleString()}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Orders</span>
      <span class="metric-value">{metrics.orderCount.toLocaleString()}</span>
    </div>
  {/if}

  {#if streamMetrics}
    <div class="metric-row">
      <span class="metric-label">Orders</span>
      <span class="metric-value">{streamMetrics.orderCount.toLocaleString()}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Bid levels</span>
      <span class="metric-value">{streamMetrics.bidLevelCount.toLocaleString()}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Ask levels</span>
      <span class="metric-value">{streamMetrics.askLevelCount.toLocaleString()}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Rebuild</span>
      <span class="metric-value">{streamMetrics.lastRebuildMs.toFixed(1)} ms</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Diffs applied</span>
      <span class="metric-value">{streamMetrics.diffsApplied.toLocaleString()}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">WS messages</span>
      <span class="metric-value">{streamMetrics.messagesReceived.toLocaleString()}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Rebuild rate</span>
      <span class="metric-value">{streamMetrics.rebuildIntervalMs} ms</span>
    </div>
  {/if}

  <div class="metric-row">
    <span class="metric-label">Render</span>
    <span class="metric-value">WebGL2 instanced</span>
  </div>
</div>

<style>
  .metrics {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .metric-title {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .metric-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }

  .metric-label {
    color: var(--text-dim);
  }

  .metric-value {
    color: var(--text);
  }
</style>
