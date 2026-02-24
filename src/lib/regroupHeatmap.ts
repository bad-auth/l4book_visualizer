import type { HeatmapData } from './types';

/**
 * Regroup heatmap orders into larger tick buckets.
 * @param original  The original heatmap data (with base tick size)
 * @param newTickSize  The desired tick size (must be a multiple of original.tickSize)
 * @returns  A new HeatmapData with orders grouped into wider price columns
 */
export function regroupHeatmap(original: HeatmapData, newTickSize: number): HeatmapData {
  if (newTickSize <= original.tickSize) return original;

  const count = original.count;
  const baseTick = original.tickSize;

  // Snap bids down (floor) and asks up (ceil) so they never share a column
  const groupedPriceFor = (price: number, side: number) => {
    if (side === 0) {
      // Bid: snap down
      return Math.floor(price / newTickSize + 1e-9) * newTickSize;
    } else {
      // Ask: snap up
      return Math.ceil(price / newTickSize - 1e-9) * newTickSize;
    }
  };

  // Group order indices by (snapped price, side)
  const byPriceSide = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const gp = groupedPriceFor(original.prices[i], original.sides[i]);
    const key = `${gp}:${original.sides[i]}`;
    let group = byPriceSide.get(key);
    if (!group) {
      group = [];
      byPriceSide.set(key, group);
    }
    group.push(i);
  }

  // Build new arrays with regrouped stacking
  const newPrices = new Float32Array(count);
  const newYOffsets = new Float32Array(count);
  const newSizes = new Float32Array(count);
  const newSides = new Float32Array(count);
  const newBrightness = new Float32Array(count);
  const newTimestamps = new Float64Array(count);
  const newUsers: string[] = new Array(count);

  let idx = 0;
  let maxCumSize = 0;

  for (const [key, group] of byPriceSide) {
    const gp = parseFloat(key.split(':')[0]);

    // Sort by timestamp within group (oldest at bottom)
    group.sort((a, b) => original.timestamps[a] - original.timestamps[b]);

    let cumOffset = 0;
    for (const oi of group) {
      newPrices[idx] = gp;
      newYOffsets[idx] = cumOffset;
      newSizes[idx] = original.sizes[oi];
      newSides[idx] = original.sides[oi];
      newBrightness[idx] = original.brightness[oi];
      newTimestamps[idx] = original.timestamps[oi];
      newUsers[idx] = original.users[oi];
      cumOffset += original.sizes[oi];
      idx++;
    }
    if (cumOffset > maxCumSize) maxCumSize = cumOffset;
  }

  const priceSet = new Set<number>();
  for (const key of byPriceSide.keys()) priceSet.add(parseFloat(key.split(':')[0]));
  const uniquePrices = Array.from(priceSet).sort((a, b) => a - b);

  return {
    prices: newPrices,
    yOffsets: newYOffsets,
    sizes: newSizes,
    sides: newSides,
    brightness: newBrightness,
    timestamps: newTimestamps,
    users: newUsers,
    maxCumSize,
    count,
    timestampMin: original.timestampMin,
    timestampMax: original.timestampMax,
    tickSize: newTickSize,
    dataPriceMin: uniquePrices[0] ?? original.dataPriceMin,
    dataPriceMax: uniquePrices[uniquePrices.length - 1] ?? original.dataPriceMax,
  };
}
