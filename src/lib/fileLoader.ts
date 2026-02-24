/** Read a File as an ArrayBuffer (non-blocking). */
export function readFileAsBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

/** Fetch a URL and return { buffer, size }. Used for dev auto-load from public/. */
export async function fetchAsBuffer(url: string): Promise<{ buffer: ArrayBuffer; size: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  return { buffer, size: buffer.byteLength };
}
