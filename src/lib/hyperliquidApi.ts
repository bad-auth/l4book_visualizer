const INFO_URL = 'https://api.hyperliquid.xyz/info';

export type DexInfo = { name: string };
export type SymbolInfo = { name: string; szDecimals: number };

export async function fetchDexes(): Promise<DexInfo[]> {
  const res = await fetch(INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'perpDexs' }),
  });
  const data: Array<{ name: string } | null> = await res.json();
  // Index 0 is null (native Hyperliquid). Filter it out.
  return data.filter((d): d is { name: string } => d != null);
}

export async function fetchSymbols(dex: string): Promise<SymbolInfo[]> {
  const body: Record<string, string> = { type: 'meta' };
  if (dex) body.dex = dex;
  const res = await fetch(INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const universe: Array<{ name: string; szDecimals: number }> = data.universe ?? [];
  // HIP-3 DEX symbols come back as "dex:SYMBOL" — strip the prefix so callers
  // get bare symbol names (e.g. "TSLA" not "xyz:TSLA").
  const prefix = dex ? `${dex}:` : '';
  return universe.map((u) => {
    const name = prefix && u.name.startsWith(prefix) ? u.name.slice(prefix.length) : u.name;
    return { name, szDecimals: u.szDecimals };
  });
}
