# L4 Book Visualizer

A web UI for visualizing Hyperliquid L4 (level 4) orderbook data. Connects to an L4 orderbook WebSocket server and renders a live heatmap and depth chart.

## Features

- **Live WebSocket streaming** — Connects to an l4Book server, receives a snapshot, then applies incremental diffs
- **Canvas/WebGL heatmap** — Orders stacked by price level, color-coded by age (brighter = newer)
- **Depth chart** — Cumulative volume visualization for bids and asks
- **Web Worker processing** — JSON parsing, diff application, and typed array construction happen off the main thread
- **Interactive controls** — Adjustable tick size, rebuild interval, zoom, pan, and pause/resume
- **Address tracking** — Monitor LP positions by wallet address via the Hyperliquid API
- **Multi-DEX support** — Native Hyperliquid orderbooks and HIP-3 DEX orderbooks
- **Performance metrics** — Parse time, rebuild time, order counts, and stream statistics

## Prerequisites

This app requires a WebSocket endpoint that serves `l4Book` channel data. The public Hyperliquid API (`wss://api.hyperliquid.xyz/ws`) does **not** provide L4 orderbook data. You need one of the following:

- **Self-hosted server** — Run the order book server from [`hyperliquid-dex/order_book_server`](https://github.com/hyperliquid-dex/order_book_server)
- **Third-party provider** — Use a service like [Dwellir](https://www.dwellir.com/) that provides L4 orderbook WebSocket access

## Tech Stack

- Svelte 5 + TypeScript
- Vite
- Web Workers
- Canvas / WebGL

## Getting Started

### Install dependencies

```sh
npm install
```

### Run the dev server

```sh
npm run dev
```

Opens at `http://localhost:5173`.

### Build for production

```sh
npm run build
```

Output goes to `dist/`.

### Type check

```sh
npm run check
```

## Usage

1. Start the dev server with `npm run dev`
2. Enter your l4Book WebSocket URL in the connection panel
3. Select a DEX (leave blank for native) and symbol (e.g. `BTC`)
4. Click **Connect** — the app receives a snapshot and then applies live diffs

### Controls

- **Tick Size** — Group orders by price increment (0.01, 0.1, 1, etc.)
- **Rebuild Interval** — Trade off update frequency vs CPU usage (50ms–1000ms)
- **Reset View** — Zoom to default range (+/-200 bps from mid)
- **Zoom Spread** — Zoom tight around the spread (+/-50 bps)
- **Pause/Resume** — Freeze updates during streaming

## Architecture

```
WebSocket → Web Worker (parse, aggregate, build typed arrays)
                ↓
           App.svelte (reactive state)
                ↓
         OrderBook.svelte → Heatmap (WebGL) + DepthChart (Canvas)
```

All heavy computation runs in a Web Worker. The main thread only handles rendering and user interaction. Data is passed as typed arrays (`Float64Array`, `Float32Array`) for memory efficiency.
