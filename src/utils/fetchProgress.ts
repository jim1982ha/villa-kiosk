// src/utils/fetchProgress.ts
// Read a fetch Response to an ArrayBuffer while reporting download progress
// (0..1) — shared by BabylonCanvas's normal model load and modelPrefetch's
// background download so both report progress identically. Falls back to a
// plain arrayBuffer() read when the stream or Content-Length isn't available
// (e.g. a service-worker cache hit with no length header).
export async function readWithProgress(
  resp: Response,
  onProgress: (frac: number) => void,
): Promise<ArrayBuffer> {
  const total = Number(resp.headers.get("Content-Length")) || 0;
  if (!resp.body || !total) return resp.arrayBuffer();
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}
