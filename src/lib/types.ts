export type TrackedAddress = {
  address: string;
  color: string;
  label?: string;
  positionSize?: number;
};

export type SnapshotMeta = {
  coin: string;
  time: number;
  height: number;
};

export type SideData = {
  prices: Float64Array;
  sizes: Float64Array;
  cumSizes: Float64Array;
};

export type HeatmapData = {
  prices: Float32Array;       // price for each order
  yOffsets: Float32Array;     // cumulative size offset (bottom of each bar segment)
  sizes: Float32Array;        // size of each order (height of bar segment)
  sides: Float32Array;        // 0=bid, 1=ask
  brightness: Float32Array;   // normalized [0,1] — rank-based order age (0=oldest, 1=newest)
  timestamps: Float64Array;   // actual timestamp in ms per order (for overlay display)
  users: string[];            // user address per order (same stacking order as typed arrays)
  maxCumSize: number;         // tallest stacked column across all price levels
  count: number;
  timestampMin: number;       // ms — earliest order timestamp
  timestampMax: number;       // ms — latest order timestamp
  tickSize: number;           // minimum price increment (e.g. 0.1 for 1 decimal place)
  dataPriceMin: number;       // lowest price in the dataset
  dataPriceMax: number;       // highest price in the dataset
};

export type ViewRange = {
  priceMin: number;
  priceMax: number;
  yMin: number;
  yMax: number;
};

export type SnapshotView = {
  meta: SnapshotMeta;
  bids: SideData;
  asks: SideData;
  heatmap: HeatmapData;
};

export type ParseMetrics = {
  fileSizeMB: number;
  parseTimeMs: number;
  transformTimeMs: number;
  bidCount: number;
  askCount: number;
  orderCount: number;
};

export type StreamMetrics = {
  orderCount: number;
  bidLevelCount: number;
  askLevelCount: number;
  lastRebuildMs: number;
  diffsApplied: number;
  messagesReceived: number;
  rebuildIntervalMs: number;
};

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'subscribed' | 'disconnected' | 'error';

export type WorkerMessage =
  | { type: 'success'; data: SnapshotView; metrics: ParseMetrics }
  | { type: 'error'; error: string };

// Book worker messages (worker → main)
export type BookWorkerOutMessage =
  | { type: 'status'; status: ConnectionStatus; message?: string }
  | { type: 'snapshot'; data: SnapshotView; metrics: StreamMetrics }
  | { type: 'update'; data: SnapshotView; metrics: StreamMetrics }
  | { type: 'fileResult'; data: SnapshotView; metrics: ParseMetrics }
  | { type: 'fileError'; error: string };

// Book worker messages (main → worker)
export type BookWorkerInMessage =
  | { type: 'connect'; url: string; coin: string }
  | { type: 'disconnect' }
  | { type: 'setRebuildInterval'; intervalMs: number }
  | { type: 'parseFile'; buffer: ArrayBuffer; fileSize: number };
