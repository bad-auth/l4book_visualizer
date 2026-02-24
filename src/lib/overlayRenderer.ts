import type { HeatmapData, ViewRange, TrackedAddress } from "./types";

export type OverlayState = {
  mouseX: number;
  mouseY: number;
  visible: boolean;
};

export type NearestOrder = {
  price: number;
  size: number;
  yOffset: number;
  side: "Bid" | "Ask";
  brightness: number;
  timestamp: number; // denormalized ms
  index: number;
  user: string;
};

/** Compute "nice" tick values for axis labels */
function niceStep(range: number, maxTicks: number): number {
  const rough = range / maxTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  let nice: number;
  if (frac <= 1.5) nice = 1;
  else if (frac <= 3) nice = 2;
  else if (frac <= 7) nice = 5;
  else nice = 10;
  return nice * pow;
}

function generateTicks(min: number, max: number, maxTicks: number): number[] {
  const step = niceStep(max - min, maxTicks);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max; v += step) {
    ticks.push(v);
  }
  return ticks;
}

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toFixed(0);
  if (p >= 100) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

function fmtSize(s: number): string {
  if (s >= 1000) return s.toFixed(1);
  if (s >= 100) return s.toFixed(2);
  if (s >= 1) return s.toFixed(4);
  return s.toFixed(5);
}

function fmtNotional(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const d = Math.floor(ms / 86_400_000);
  ms %= 86_400_000;
  const h = Math.floor(ms / 3_600_000);
  ms %= 3_600_000;
  const m = Math.floor(ms / 60_000);
  ms %= 60_000;
  const s = Math.floor(ms / 1_000);
  const rem = Math.round(ms % 1_000);

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);
  parts.push(`${rem}ms`);
  return parts.join(" ");
}

export function findNearestOrder(
  data: HeatmapData,
  range: ViewRange,
  fx: number, // fraction [0,1] x within canvas
  fy: number, // fraction [0,1] y within canvas (0=top)
): NearestOrder | null {
  const targetPrice = range.priceMin + fx * (range.priceMax - range.priceMin);
  // Canvas y=0 is top=yMax, y=height is bottom=yMin
  const targetY = range.yMax - fy * (range.yMax - range.yMin);

  const priceRange = range.priceMax - range.priceMin;
  const yRange = range.yMax - range.yMin;
  if (priceRange <= 0 || yRange <= 0) return null;

  // Step 1: Find the nearest price level within half a tick
  const halfTick = data.tickSize / 2;
  let bestPriceDist = Infinity;
  let snapPrice = NaN;

  for (let i = 0; i < data.count; i++) {
    const d = Math.abs(data.prices[i] - targetPrice);
    if (d < bestPriceDist) {
      bestPriceDist = d;
      snapPrice = data.prices[i];
    }
  }

  // Don't select if cursor is more than half a tick away from nearest price
  if (bestPriceDist > halfTick) return null;

  // Step 2: Among orders at this price, find the one whose bar contains
  // the cursor Y, or is closest to it
  let bestIdx = -1;
  let bestYDist = Infinity;

  for (let i = 0; i < data.count; i++) {
    if (data.prices[i] !== snapPrice) continue;
    const top = data.yOffsets[i] + data.sizes[i];
    const bot = data.yOffsets[i];
    // Distance is 0 if cursor is inside the bar
    const yDist =
      targetY >= bot && targetY <= top
        ? 0
        : Math.min(Math.abs(targetY - bot), Math.abs(targetY - top));
    if (yDist < bestYDist) {
      bestYDist = yDist;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;

  return {
    price: data.prices[bestIdx],
    size: data.sizes[bestIdx],
    yOffset: data.yOffsets[bestIdx],
    side: data.sides[bestIdx] === 0 ? "Bid" : "Ask",
    brightness: data.brightness[bestIdx],
    timestamp: data.timestamps[bestIdx],
    index: bestIdx,
    user: data.users[bestIdx],
  };
}

export function renderOverlay(
  ctx: CanvasRenderingContext2D,
  range: ViewRange,
  data: HeatmapData,
  state: OverlayState,
  canvasWidth: number,
  canvasHeight: number,
  trackedAddresses?: TrackedAddress[],
) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const priceRange = range.priceMax - range.priceMin;
  const yRange = range.yMax - range.yMin;

  // --- Axis labels ---
  ctx.font = "15px monospace";
  ctx.textBaseline = "top";

  // Price axis (bottom)
  const priceTicks = generateTicks(
    range.priceMin,
    range.priceMax,
    Math.floor(canvasWidth / 150),
  );
  ctx.fillStyle = "#6b7a8d";
  ctx.strokeStyle = "rgba(107,122,141,0.15)";
  ctx.lineWidth = 1;

  const halfTick = data.tickSize / 2;
  for (const p of priceTicks) {
    // Draw grid line at the edge of the tick (offset by half tick from center)
    const xEdge = ((p - halfTick - range.priceMin) / priceRange) * canvasWidth;
    if (xEdge >= 0 && xEdge <= canvasWidth) {
      ctx.beginPath();
      ctx.moveTo(xEdge, 0);
      ctx.lineTo(xEdge, canvasHeight);
      ctx.stroke();
    }

    // Label stays centered on the tick
    const xCenter = ((p - range.priceMin) / priceRange) * canvasWidth;
    ctx.textAlign = "center";
    ctx.fillText(fmtPrice(p), xCenter, canvasHeight - 21);
  }

  // Y axis (left) — cumulative size
  const yTicks = generateTicks(
    range.yMin,
    range.yMax,
    Math.floor(canvasHeight / 90),
  );
  for (const v of yTicks) {
    // yMax at top (y=0), yMin at bottom (y=canvasHeight)
    const y = ((range.yMax - v) / yRange) * canvasHeight;
    if (y < 0 || y > canvasHeight) continue;

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "#6b7a8d";
    ctx.fillText(fmtSize(v), 6, y + 3);
  }

  if (!state.visible) return;

  // Crosshair
  const mx = state.mouseX;
  const my = state.mouseY;

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(197,205,217,0.5)";
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(mx, 0);
  ctx.lineTo(mx, canvasHeight);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, my);
  ctx.lineTo(canvasWidth, my);
  ctx.stroke();

  ctx.setLineDash([]);

  // Cursor coordinate labels
  const cursorPrice = range.priceMin + (mx / canvasWidth) * priceRange;
  const cursorY = range.yMax - (my / canvasHeight) * yRange;

  // Price label at crosshair (bottom of vertical line)
  ctx.fillStyle = "#111621";
  const pLabel = fmtPrice(cursorPrice);
  const pLabelW = ctx.measureText(pLabel).width + 12;
  ctx.fillRect(mx - pLabelW / 2, canvasHeight - 24, pLabelW, 24);
  ctx.fillStyle = "#c5cdd9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pLabel, mx, canvasHeight - 12);

  // Size label at crosshair (left of horizontal line)
  const yLabel = fmtSize(cursorY);
  const yLabelW = ctx.measureText(yLabel).width + 12;
  ctx.fillStyle = "#111621";
  ctx.fillRect(0, my - 12, yLabelW, 24);
  ctx.fillStyle = "#c5cdd9";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(yLabel, 6, my);

  // Nearest order tooltip
  const fx = mx / canvasWidth;
  const fy = my / canvasHeight;
  const nearest = findNearestOrder(data, range, fx, fy);
  if (nearest) {
    // Outline the hovered order bar
    const barCenterX =
      ((nearest.price - range.priceMin) / priceRange) * canvasWidth;
    const tickNDC = data.tickSize / priceRange;
    const barW = Math.max(tickNDC * canvasWidth, 1);
    const barTop =
      ((range.yMax - (nearest.yOffset + nearest.size)) / yRange) * canvasHeight;
    const barBottom = ((range.yMax - nearest.yOffset) / yRange) * canvasHeight;
    const barH = barBottom - barTop;

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(barCenterX - barW / 2, barTop, barW, barH);

    // Compute total size at this price level
    let tickTotal = 0;
    for (let i = 0; i < data.count; i++) {
      if (data.prices[i] === nearest.price) tickTotal += data.sizes[i];
    }

    // Check if this order's user is a tracked address
    const trackedMatch = trackedAddresses?.find(
      (t) => t.address.toLowerCase() === nearest.user.toLowerCase(),
    );
    const truncAddr = nearest.user
      ? `${nearest.user.slice(0, 6)}...${nearest.user.slice(-4)}`
      : "";
    const orderNotional = nearest.price * nearest.size;
    const levelNotional = nearest.price * tickTotal;
    const lines = [
      `${nearest.side}  $${fmtPrice(nearest.price)}`,
      `Size: ${fmtSize(nearest.size)}  /  ${fmtSize(tickTotal)}`,
      `Ntl: ${fmtNotional(orderNotional)}  /  ${fmtNotional(levelNotional)}`,
      `T - ${fmtDuration(data.timestampMax - nearest.timestamp)}`,
    ];
    if (truncAddr) {
      lines.push(truncAddr);
    }

    ctx.font = "24px monospace";
    const lineH = 33;
    const pad = 14;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    const h = lines.length * lineH + pad * 2;

    // Position tooltip: avoid going off-canvas
    let tx = mx + 30;
    let ty = my - h - 15;
    if (tx + w > canvasWidth) tx = mx - w - 30;
    if (ty < 0) ty = my + 30;

    ctx.fillStyle = "rgba(17,22,33,0.92)";
    ctx.strokeStyle = "rgba(107,122,141,0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(tx, ty, w, h, 6);
    ctx.fill();
    ctx.stroke();

    // Header color: tracked color if matched, otherwise default bid/ask
    ctx.fillStyle = trackedMatch
      ? trackedMatch.color
      : nearest.side === "Bid"
        ? "#00c853"
        : "#ff1744";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(lines[0], tx + pad, ty + pad);

    ctx.fillStyle = "#c5cdd9";
    for (let i = 1; i < lines.length; i++) {
      // Use tracked color for the address line
      if (i === lines.length - 1 && trackedMatch) {
        ctx.fillStyle = trackedMatch.color;
      }
      ctx.fillText(lines[i], tx + pad, ty + pad + i * lineH);
      if (i === lines.length - 1 && trackedMatch) {
        ctx.fillStyle = "#c5cdd9";
      }
    }
  }
}
