/// Web Worker: parses L4 book snapshot JSON, aggregates by price level,
/// sorts, and returns typed arrays for efficient rendering.
/// Also extracts individual orders with stacking offsets for the heatmap.

interface RawOrder {
  side: 'B' | 'A';
  limitPx: string;
  sz: string;
  oid?: number;
  timestamp: number;
  user: string;
  isTrigger?: boolean;
}

interface ParsedOrder {
  idx: number;    // original index in flat order list
  price: number;
  size: number;
  side: number;   // 0=bid, 1=ask
  timestamp: number;
  user: string;
}

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; fileSize: number }>) => {
  const { buffer, fileSize } = e.data;

  const text = new TextDecoder().decode(buffer);

  // --- Parse ---
  const t0 = performance.now();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    self.postMessage({ type: 'error', error: 'Invalid JSON' });
    return;
  }
  const parseTimeMs = performance.now() - t0;

  // --- Transform ---
  const t1 = performance.now();

  const snapshot = parsed?.data?.Snapshot;
  if (!snapshot) {
    self.postMessage({ type: 'error', error: 'Missing data.Snapshot in file' });
    return;
  }

  const { coin, time, height, levels } = snapshot;

  // Flatten all levels into a single order list, excluding trigger orders
  const rawOrders: RawOrder[] = (levels as RawOrder[][]).flat().filter(o => !o.isTrigger);
  const orderCount = rawOrders.length;

  // Parse orders and extract timestamps for brightness
  const parsed_orders: ParsedOrder[] = new Array(orderCount);
  let minTs = Infinity;
  let maxTs = -Infinity;

  // Aggregate sizes by price level for depth chart
  const bidMap = new Map<number, number>();
  const askMap = new Map<number, number>();

  for (let i = 0; i < orderCount; i++) {
    const o = rawOrders[i];
    const price = parseFloat(o.limitPx);
    const size = parseFloat(o.sz);
    const ts = o.timestamp;

    parsed_orders[i] = {
      idx: i,
      price,
      size,
      side: o.side === 'B' ? 0 : 1,
      timestamp: ts,
      user: o.user || '',
    };

    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;

    if (o.side === 'B') {
      bidMap.set(price, (bidMap.get(price) || 0) + size);
    } else {
      askMap.set(price, (askMap.get(price) || 0) + size);
    }
  }

  // --- Group by price and compute stacking offsets ---
  const byPrice = new Map<number, ParsedOrder[]>();
  for (const o of parsed_orders) {
    let group = byPrice.get(o.price);
    if (!group) {
      group = [];
      byPrice.set(o.price, group);
    }
    group.push(o);
  }

  // --- Compute tick size from minimum price difference between levels ---
  const uniquePrices = Array.from(byPrice.keys()).sort((a, b) => a - b);
  let tickSize = 1;
  if (uniquePrices.length >= 2) {
    let minDiff = Infinity;
    for (let i = 1; i < uniquePrices.length; i++) {
      const diff = uniquePrices[i] - uniquePrices[i - 1];
      if (diff > 1e-9 && diff < minDiff) minDiff = diff;
    }
    if (minDiff < Infinity) {
      tickSize = Math.round(minDiff * 1e8) / 1e8;
    }
  }

  // Sort within each group by timestamp ascending (oldest at bottom of stack, dimmest)
  const hmPrices = new Float32Array(orderCount);
  const hmYOffsets = new Float32Array(orderCount);
  const hmSizes = new Float32Array(orderCount);
  const hmSides = new Float32Array(orderCount);
  const hmBrightness = new Float32Array(orderCount);
  const hmTimestamps = new Float64Array(orderCount);
  const hmUsers: string[] = new Array(orderCount);

  // Rank-based brightness: sort all orders by timestamp and assign brightness
  // by rank. This avoids Float32 precision loss when the global timestamp range
  // is huge (years) but visible orders differ by milliseconds.
  const rankOrder = parsed_orders
    .map((o, i) => ({ ts: o.timestamp, i }))
    .sort((a, b) => a.ts - b.ts);
  const rankBrightness = new Float32Array(orderCount);
  const maxRank = orderCount - 1;
  for (let r = 0; r < orderCount; r++) {
    rankBrightness[rankOrder[r].i] = maxRank > 0 ? r / maxRank : 0.5;
  }

  let idx = 0;
  let maxCumSize = 0;

  for (const [, group] of byPrice) {
    group.sort((a, b) => a.timestamp - b.timestamp);
    let cumOffset = 0;
    for (const o of group) {
      hmPrices[idx] = o.price;
      hmYOffsets[idx] = cumOffset;
      hmSizes[idx] = o.size;
      hmSides[idx] = o.side;
      // Brightness: 0 = oldest order, 1 = newest order (rank-based)
      hmBrightness[idx] = rankBrightness[o.idx];
      hmTimestamps[idx] = o.timestamp;
      hmUsers[idx] = o.user;
      cumOffset += o.size;
      idx++;
    }
    if (cumOffset > maxCumSize) maxCumSize = cumOffset;
  }

  // Sort aggregated depth: bids descending, asks ascending
  const bidEntries = Array.from(bidMap.entries()).sort((a, b) => b[0] - a[0]);
  const askEntries = Array.from(askMap.entries()).sort((a, b) => a[0] - b[0]);

  // Build typed arrays for aggregated depth
  const bidPrices = new Float64Array(bidEntries.length);
  const bidSizes = new Float64Array(bidEntries.length);
  const bidCumSizes = new Float64Array(bidEntries.length);

  let cum = 0;
  for (let i = 0; i < bidEntries.length; i++) {
    bidPrices[i] = bidEntries[i][0];
    bidSizes[i] = bidEntries[i][1];
    cum += bidEntries[i][1];
    bidCumSizes[i] = cum;
  }

  const askPrices = new Float64Array(askEntries.length);
  const askSizes = new Float64Array(askEntries.length);
  const askCumSizes = new Float64Array(askEntries.length);

  cum = 0;
  for (let i = 0; i < askEntries.length; i++) {
    askPrices[i] = askEntries[i][0];
    askSizes[i] = askEntries[i][1];
    cum += askEntries[i][1];
    askCumSizes[i] = cum;
  }

  const transformTimeMs = performance.now() - t1;

  const result = {
    type: 'success' as const,
    data: {
      meta: { coin, time, height },
      bids: { prices: bidPrices, sizes: bidSizes, cumSizes: bidCumSizes },
      asks: { prices: askPrices, sizes: askSizes, cumSizes: askCumSizes },
      heatmap: {
        prices: hmPrices,
        yOffsets: hmYOffsets,
        sizes: hmSizes,
        sides: hmSides,
        brightness: hmBrightness,
        timestamps: hmTimestamps,
        users: hmUsers,
        maxCumSize,
        count: orderCount,
        timestampMin: minTs,
        timestampMax: maxTs,
        tickSize,
        dataPriceMin: uniquePrices[0] ?? 0,
        dataPriceMax: uniquePrices[uniquePrices.length - 1] ?? 0,
      },
    },
    metrics: {
      fileSizeMB: fileSize / (1024 * 1024),
      parseTimeMs: Math.round(parseTimeMs * 100) / 100,
      transformTimeMs: Math.round(transformTimeMs * 100) / 100,
      bidCount: bidEntries.length,
      askCount: askEntries.length,
      orderCount,
    },
  };

  // Transfer ArrayBuffers for zero-copy handoff
  self.postMessage(result, {
    transfer: [
      bidPrices.buffer,
      bidSizes.buffer,
      bidCumSizes.buffer,
      askPrices.buffer,
      askSizes.buffer,
      askCumSizes.buffer,
      hmPrices.buffer,
      hmYOffsets.buffer,
      hmSizes.buffer,
      hmSides.buffer,
      hmBrightness.buffer,
      hmTimestamps.buffer,
    ],
  } as any);
};
