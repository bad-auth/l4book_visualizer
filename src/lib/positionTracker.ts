export type PositionInfo = {
  size: number;
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
};

export type PositionUpdateCallback = (address: string, position: PositionInfo | null) => void;

export type PositionTracker = {
  subscribe(address: string): void;
  unsubscribe(address: string): void;
  setCoin(coin: string): void;
  destroy(): void;
};

const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * Opens one WS connection per tracked address to wss://api.hyperliquid.xyz/ws,
 * subscribing to clearinghouseState. Extracts position size for the active coin.
 */
export function createPositionTracker(onUpdate: PositionUpdateCallback): PositionTracker {
  let coin = '';
  let destroyed = false;

  type AddrConn = {
    ws: WebSocket | null;
    reconnectAttempt: number;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    latestData: any;
  };

  const connections = new Map<string, AddrConn>();

  function connectAddr(address: string) {
    const conn = connections.get(address);
    if (!conn || destroyed) return;

    const ws = new WebSocket(WS_URL);
    conn.ws = ws;

    ws.onopen = () => {
      conn.reconnectAttempt = 0;
      ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'clearinghouseState', user: address },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.channel === 'clearinghouseState' && msg.data) {
          const state = msg.data.clearinghouseState ?? msg.data;
          conn.latestData = state;
          emitPosition(address, state);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      conn.ws = null;
      if (!destroyed && connections.has(address)) {
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** conn.reconnectAttempt, RECONNECT_MAX_MS);
        conn.reconnectAttempt++;
        conn.reconnectTimer = setTimeout(() => connectAddr(address), delay);
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror
    };
  }

  function closeAddr(address: string) {
    const conn = connections.get(address);
    if (!conn) return;
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    if (conn.ws) {
      conn.ws.onclose = null;
      conn.ws.close();
    }
    connections.delete(address);
  }

  function emitPosition(address: string, data: any) {
    if (!coin || !data) {
      onUpdate(address, null);
      return;
    }
    const positions: any[] = data.assetPositions || [];
    const match = positions.find((p: any) => p?.position?.coin === coin);
    if (!match?.position) {
      onUpdate(address, null);
      return;
    }
    const p = match.position;
    onUpdate(address, {
      size: parseFloat(p.szi) || 0,
      entryPx: parseFloat(p.entryPx) || 0,
      positionValue: parseFloat(p.positionValue) || 0,
      unrealizedPnl: parseFloat(p.unrealizedPnl) || 0,
    });
  }

  return {
    subscribe(address: string) {
      if (connections.has(address)) return;
      connections.set(address, {
        ws: null,
        reconnectAttempt: 0,
        reconnectTimer: null,
        latestData: null,
      });
      connectAddr(address);
    },

    unsubscribe(address: string) {
      closeAddr(address);
      onUpdate(address, null);
    },

    setCoin(newCoin: string) {
      if (newCoin === coin) return;
      coin = newCoin;
      for (const [address, conn] of connections) {
        emitPosition(address, conn.latestData);
      }
    },

    destroy() {
      destroyed = true;
      for (const address of [...connections.keys()]) {
        closeAddr(address);
      }
    },
  };
}
