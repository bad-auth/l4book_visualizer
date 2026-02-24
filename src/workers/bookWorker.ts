/// Web Worker: handles WebSocket streaming with incremental diffs AND file-based parsing.
/// Maintains an orders Map for O(1) diff application and batched typed-array rebuilds.

import type { BookWorkerInMessage } from '../lib/types';

interface Order {
  oid: number;
  side: number;    // 0=bid, 1=ask
  price: number;
  size: number;
  timestamp: number;
  user: string;
}

// --- Worker state ---
const orders = new Map<number, Order>();
let meta = { coin: '', time: 0, height: 0 };
let dirty = false;
let rebuildIntervalMs = 100;   // 10fps — standard for orderbook UIs
let rebuildTimer: ReturnType<typeof setInterval> | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let messagesReceived = 0;
let diffsSinceLastRebuild = 0;
let pendingCoin = '';
let pendingUrl = '';

// --- Persistent incremental state (maintained by add/remove helpers) ---
const byPrice = new Map<number, Order[]>();
const bidMap = new Map<number, number>();   // price → total size
const askMap = new Map<number, number>();   // price → total size
let cachedTickSize = 1;

// --- Helpers ---

function parseOrder(raw: any): Order | null {
  if (raw.isTrigger && raw.triggerCondition !== 'Triggered') return null;
  return {
    oid: raw.oid,
    side: raw.side === 'B' ? 0 : 1,
    price: parseFloat(raw.limitPx),
    size: parseFloat(raw.sz),
    timestamp: raw.timestamp,
    user: raw.user || '',
  };
}

function addOrderToGroups(o: Order) {
  let group = byPrice.get(o.price);
  if (!group) {
    group = [];
    byPrice.set(o.price, group);
  }
  group.push(o);

  const map = o.side === 0 ? bidMap : askMap;
  map.set(o.price, (map.get(o.price) || 0) + o.size);
}

function removeOrderFromGroups(o: Order) {
  const group = byPrice.get(o.price);
  if (group) {
    const idx = group.indexOf(o);
    if (idx >= 0) group.splice(idx, 1);
    if (group.length === 0) byPrice.delete(o.price);
  }

  const map = o.side === 0 ? bidMap : askMap;
  const prev = map.get(o.price) || 0;
  const next = prev - o.size;
  if (next <= 1e-12) {
    map.delete(o.price);
  } else {
    map.set(o.price, next);
  }
}

function clearIncrementalState() {
  byPrice.clear();
  bidMap.clear();
  askMap.clear();
  cachedTickSize = 1;
}

function getTransferList(result: any): ArrayBuffer[] {
  const transfers: ArrayBuffer[] = [];
  const { bids, asks, heatmap } = result.data;
  transfers.push(
    bids.prices.buffer, bids.sizes.buffer, bids.cumSizes.buffer,
    asks.prices.buffer, asks.sizes.buffer, asks.cumSizes.buffer,
    heatmap.prices.buffer, heatmap.yOffsets.buffer, heatmap.sizes.buffer,
    heatmap.sides.buffer, heatmap.brightness.buffer, heatmap.timestamps.buffer,
  );
  return transfers;
}

function buildSnapshotView() {
  const t0 = performance.now();

  const orderCount = orders.size;
  if (orderCount === 0) return null;

  // Build heatmap arrays — single pass over pre-grouped byPrice
  const hmPrices = new Float32Array(orderCount);
  const hmYOffsets = new Float32Array(orderCount);
  const hmSizes = new Float32Array(orderCount);
  const hmSides = new Float32Array(orderCount);
  const hmBrightness = new Float32Array(orderCount);
  const hmTimestamps = new Float64Array(orderCount);
  const hmUsers: string[] = new Array(orderCount);

  let minTs = Infinity;
  let maxTs = -Infinity;

  let idx = 0;
  let maxCumSize = 0;

  for (const [, group] of byPrice) {
    group.sort((a, b) => a.timestamp - b.timestamp);
    const groupMax = group.length - 1;
    let cumOffset = 0;
    for (let gi = 0; gi < group.length; gi++) {
      const o = group[gi];
      hmPrices[idx] = o.price;
      hmYOffsets[idx] = cumOffset;
      hmSizes[idx] = o.size;
      hmSides[idx] = o.side;
      // Per-group rank brightness: oldest=0 (dimmest), newest=1 (brightest)
      hmBrightness[idx] = groupMax > 0 ? gi / groupMax : 0.5;
      hmTimestamps[idx] = o.timestamp;
      hmUsers[idx] = o.user;
      if (o.timestamp < minTs) minTs = o.timestamp;
      if (o.timestamp > maxTs) maxTs = o.timestamp;
      cumOffset += o.size;
      idx++;
    }
    if (cumOffset > maxCumSize) maxCumSize = cumOffset;
  }

  // Build depth arrays directly from cached bidMap/askMap
  const bidEntries = Array.from(bidMap.entries()).sort((a, b) => b[0] - a[0]);
  const askEntries = Array.from(askMap.entries()).sort((a, b) => a[0] - b[0]);

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

  // Price bounds from byPrice keys (O(k) where k = unique prices)
  let dataPriceMin = Infinity;
  let dataPriceMax = -Infinity;
  for (const p of byPrice.keys()) {
    if (p < dataPriceMin) dataPriceMin = p;
    if (p > dataPriceMax) dataPriceMax = p;
  }
  if (dataPriceMin === Infinity) dataPriceMin = 0;
  if (dataPriceMax === -Infinity) dataPriceMax = 0;

  const lastRebuildMs = Math.round((performance.now() - t0) * 100) / 100;

  return {
    data: {
      meta,
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
        tickSize: cachedTickSize,
        dataPriceMin,
        dataPriceMax,
      },
    },
    metrics: {
      orderCount,
      bidLevelCount: bidEntries.length,
      askLevelCount: askEntries.length,
      lastRebuildMs,
      diffsApplied: diffsSinceLastRebuild,
      messagesReceived,
      rebuildIntervalMs,
    },
  };
}

// --- WebSocket handling ---

function handleSnapshot(snapshot: any) {
  orders.clear();
  clearIncrementalState();

  const { coin, time, height, levels } = snapshot;
  meta = { coin, time, height };

  const rawOrders: any[] = (levels as any[][]).flat();
  for (const raw of rawOrders) {
    const o = parseOrder(raw);
    if (o) {
      orders.set(o.oid, o);
      addOrderToGroups(o);
    }
  }

  // Compute and cache tick size (never changes during streaming)
  const uniquePrices = Array.from(byPrice.keys()).sort((a, b) => a - b);
  cachedTickSize = 1;
  if (uniquePrices.length >= 2) {
    let minDiff = Infinity;
    for (let i = 1; i < uniquePrices.length; i++) {
      const diff = uniquePrices[i] - uniquePrices[i - 1];
      if (diff > 1e-9 && diff < minDiff) minDiff = diff;
    }
    if (minDiff < Infinity) {
      cachedTickSize = Math.round(minDiff * 1e8) / 1e8;
    }
  }

  diffsSinceLastRebuild = 0;
  const result = buildSnapshotView();
  if (result) {
    const msg = { type: 'snapshot' as const, ...result };
    self.postMessage(msg, { transfer: getTransferList(msg) } as any);
  }
}

// Statuses that add an order to the book
const ADD_STATUSES = new Set(['open']);
// Statuses that remove an order from the book
const REMOVE_STATUSES = new Set(['canceled', 'filled', 'marginCanceled', 'reduceOnlyCanceled']);

function handleUpdates(updates: any) {
  const orderStatuses = updates?.order_statuses;
  if (!Array.isArray(orderStatuses)) return;

  for (const entry of orderStatuses) {
    const status: string = entry?.status;
    const order = entry?.order;
    if (!order) continue;

    const oid = order.oid;
    if (oid == null) continue;

    if (ADD_STATUSES.has(status)) {
      // Skip untriggered trigger orders
      if (order.isTrigger && order.triggerCondition !== 'Triggered') continue;
      // New order on the book — user is on the parent entry, not order.user
      const o: Order = {
        oid,
        side: order.side === 'B' ? 0 : 1,
        price: parseFloat(order.limitPx),
        size: parseFloat(order.sz),
        timestamp: order.timestamp ?? Date.now(),
        user: entry.user || order.user || '',
      };
      // Remove old order from groups if oid already exists (e.g. re-sent on reconnect)
      const prev = orders.get(oid);
      if (prev) removeOrderFromGroups(prev);
      orders.set(oid, o);
      addOrderToGroups(o);
      diffsSinceLastRebuild++;
    } else if (REMOVE_STATUSES.has(status)) {
      const existing = orders.get(oid);
      if (existing) {
        removeOrderFromGroups(existing);
        orders.delete(oid);
        diffsSinceLastRebuild++;
      }
    }
    // Rejected statuses (badAloPxRejected, minTradeNtlRejected, etc.)
    // don't change the book state — ignore them.
  }

  if (diffsSinceLastRebuild > 0) dirty = true;
}

function handleWsMessage(event: MessageEvent) {
  messagesReceived++;
  let parsed: any;
  try {
    parsed = JSON.parse(event.data as string);
  } catch {
    return;
  }

  if (parsed?.channel === 'l4Book') {
    const data = parsed.data;
    if (data?.Snapshot) {
      handleSnapshot(data.Snapshot);
    } else if (data?.Updates) {
      // Update meta with latest time/height from diff messages
      if (data.Updates.time) meta.time = data.Updates.time;
      if (data.Updates.height) meta.height = data.Updates.height;
      handleUpdates(data.Updates);
    }
  }
}

function startRebuildInterval() {
  stopRebuildInterval();
  rebuildTimer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const result = buildSnapshotView();
    if (result) {
      const msg = { type: 'update' as const, ...result };
      self.postMessage(msg, { transfer: getTransferList(msg) } as any);
      diffsSinceLastRebuild = 0;
    }
  }, rebuildIntervalMs);
}

function stopRebuildInterval() {
  if (rebuildTimer !== null) {
    clearInterval(rebuildTimer);
    rebuildTimer = null;
  }
}

function clearReconnect() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnect();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs(pendingUrl, pendingCoin);
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function connectWs(url: string, coin: string) {
  disconnectWs();
  pendingUrl = url;
  pendingCoin = coin;
  messagesReceived = 0;
  diffsSinceLastRebuild = 0;

  self.postMessage({ type: 'status', status: 'connecting' });

  try {
    ws = new WebSocket(url);
  } catch (err: any) {
    self.postMessage({ type: 'status', status: 'error', message: err.message });
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectDelay = 1000;
    self.postMessage({ type: 'status', status: 'connected' });

    ws!.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'l4Book', coin },
    }));

    self.postMessage({ type: 'status', status: 'subscribed' });
    startRebuildInterval();
  };

  ws.onmessage = handleWsMessage;

  ws.onclose = () => {
    stopRebuildInterval();
    self.postMessage({ type: 'status', status: 'disconnected' });
    scheduleReconnect();
  };

  ws.onerror = () => {
    stopRebuildInterval();
    self.postMessage({ type: 'status', status: 'error', message: 'WebSocket error' });
    // onclose will fire after onerror, which triggers reconnect
  };
}

function disconnectWs() {
  clearReconnect();
  stopRebuildInterval();
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
  orders.clear();
  clearIncrementalState();
  dirty = false;
}

// --- File parsing (reuse existing logic) ---

function handleParseFile(buffer: ArrayBuffer, fileSize: number) {
  const text = new TextDecoder().decode(buffer);

  const t0 = performance.now();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    self.postMessage({ type: 'fileError', error: 'Invalid JSON' });
    return;
  }
  const parseTimeMs = performance.now() - t0;

  const t1 = performance.now();

  const snapshot = parsed?.data?.Snapshot;
  if (!snapshot) {
    self.postMessage({ type: 'fileError', error: 'Missing data.Snapshot in file' });
    return;
  }

  // Populate the orders map from the file snapshot
  orders.clear();
  const { coin, time, height, levels } = snapshot;
  meta = { coin, time, height };

  const rawOrders: any[] = (levels as any[][]).flat();
  for (const raw of rawOrders) {
    if (raw.isTrigger && raw.triggerCondition !== 'Triggered') continue;
    const o: Order = {
      oid: raw.oid,
      side: raw.side === 'B' ? 0 : 1,
      price: parseFloat(raw.limitPx),
      size: parseFloat(raw.sz),
      timestamp: raw.timestamp,
      user: raw.user || '',
    };
    orders.set(o.oid, o);
  }

  // Use snapshotWorker-style rank-based brightness for file loads (better visual quality for static data)
  const orderList = Array.from(orders.values());
  const orderCount = orderList.length;

  // Aggregate depth
  const bidMap = new Map<number, number>();
  const askMap = new Map<number, number>();

  for (const o of orderList) {
    if (o.side === 0) {
      bidMap.set(o.price, (bidMap.get(o.price) || 0) + o.size);
    } else {
      askMap.set(o.price, (askMap.get(o.price) || 0) + o.size);
    }
  }

  // Group by price
  const byPrice = new Map<number, Order[]>();
  for (const o of orderList) {
    let group = byPrice.get(o.price);
    if (!group) { group = []; byPrice.set(o.price, group); }
    group.push(o);
  }

  // Tick size
  const uniquePrices = Array.from(byPrice.keys()).sort((a, b) => a - b);
  let tickSize = 1;
  if (uniquePrices.length >= 2) {
    let minDiff = Infinity;
    for (let i = 1; i < uniquePrices.length; i++) {
      const diff = uniquePrices[i] - uniquePrices[i - 1];
      if (diff > 1e-9 && diff < minDiff) minDiff = diff;
    }
    if (minDiff < Infinity) tickSize = Math.round(minDiff * 1e8) / 1e8;
  }

  // Build heatmap with rank-based brightness
  const hmPrices = new Float32Array(orderCount);
  const hmYOffsets = new Float32Array(orderCount);
  const hmSizes = new Float32Array(orderCount);
  const hmSides = new Float32Array(orderCount);
  const hmBrightness = new Float32Array(orderCount);
  const hmTimestamps = new Float64Array(orderCount);
  const hmUsers: string[] = new Array(orderCount);

  // Rank-based brightness
  const rankOrder = orderList
    .map((o, i) => ({ ts: o.timestamp, i }))
    .sort((a, b) => a.ts - b.ts);
  const rankBrightness = new Float32Array(orderCount);
  const maxRank = orderCount - 1;
  for (let r = 0; r < orderCount; r++) {
    rankBrightness[rankOrder[r].i] = maxRank > 0 ? r / maxRank : 0.5;
  }

  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const o of orderList) {
    if (o.timestamp < minTs) minTs = o.timestamp;
    if (o.timestamp > maxTs) maxTs = o.timestamp;
  }

  let idx = 0;
  let maxCumSize = 0;
  // Build a mapping from order to its index in orderList for rank lookup
  const orderIndexMap = new Map<Order, number>();
  for (let i = 0; i < orderList.length; i++) {
    orderIndexMap.set(orderList[i], i);
  }

  for (const [, group] of byPrice) {
    group.sort((a, b) => a.timestamp - b.timestamp);
    let cumOffset = 0;
    for (const o of group) {
      hmPrices[idx] = o.price;
      hmYOffsets[idx] = cumOffset;
      hmSizes[idx] = o.size;
      hmSides[idx] = o.side;
      hmBrightness[idx] = rankBrightness[orderIndexMap.get(o)!];
      hmTimestamps[idx] = o.timestamp;
      hmUsers[idx] = o.user;
      cumOffset += o.size;
      idx++;
    }
    if (cumOffset > maxCumSize) maxCumSize = cumOffset;
  }

  // Build depth arrays
  const bidEntries = Array.from(bidMap.entries()).sort((a, b) => b[0] - a[0]);
  const askEntries = Array.from(askMap.entries()).sort((a, b) => a[0] - b[0]);

  const bidPrices = new Float64Array(bidEntries.length);
  const bidSizesArr = new Float64Array(bidEntries.length);
  const bidCumSizes = new Float64Array(bidEntries.length);
  let cum = 0;
  for (let i = 0; i < bidEntries.length; i++) {
    bidPrices[i] = bidEntries[i][0];
    bidSizesArr[i] = bidEntries[i][1];
    cum += bidEntries[i][1];
    bidCumSizes[i] = cum;
  }

  const askPricesArr = new Float64Array(askEntries.length);
  const askSizesArr = new Float64Array(askEntries.length);
  const askCumSizes = new Float64Array(askEntries.length);
  cum = 0;
  for (let i = 0; i < askEntries.length; i++) {
    askPricesArr[i] = askEntries[i][0];
    askSizesArr[i] = askEntries[i][1];
    cum += askEntries[i][1];
    askCumSizes[i] = cum;
  }

  const transformTimeMs = performance.now() - t1;

  const result = {
    type: 'fileResult' as const,
    data: {
      meta: { coin, time, height },
      bids: { prices: bidPrices, sizes: bidSizesArr, cumSizes: bidCumSizes },
      asks: { prices: askPricesArr, sizes: askSizesArr, cumSizes: askCumSizes },
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

  self.postMessage(result, {
    transfer: [
      bidPrices.buffer, bidSizesArr.buffer, bidCumSizes.buffer,
      askPricesArr.buffer, askSizesArr.buffer, askCumSizes.buffer,
      hmPrices.buffer, hmYOffsets.buffer, hmSizes.buffer,
      hmSides.buffer, hmBrightness.buffer, hmTimestamps.buffer,
    ],
  } as any);
}

// --- Message handler ---

self.onmessage = (e: MessageEvent<BookWorkerInMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'connect':
      connectWs(msg.url, msg.coin);
      break;
    case 'disconnect':
      disconnectWs();
      self.postMessage({ type: 'status', status: 'idle' });
      break;
    case 'setRebuildInterval':
      rebuildIntervalMs = msg.intervalMs;
      if (rebuildTimer !== null) startRebuildInterval(); // restart with new interval
      break;
    case 'parseFile':
      handleParseFile(msg.buffer, msg.fileSize);
      break;
  }
};
