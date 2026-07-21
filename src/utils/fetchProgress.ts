// src/utils/fetchProgress.ts
import { devLog } from "./devLog";
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

// Extra attempts after the first (so 3 total), and the backoff between them —
// deliberately short: this is recovering a dropped connection during an
// already-open load screen, not a background job that can afford to wait.
const MODEL_FETCH_RETRIES = 2;
const MODEL_FETCH_RETRY_DELAY_MS = 900;

/**
 * Fetch + read a model URL with progress, retrying a few times on a
 * NETWORK-level failure — fetch() throwing, or the stream dropping mid-read
 * (readWithProgress's reader.read() throwing) — both surface as
 * "TypeError: Failed to fetch" / similar. That's common on a public-internet
 * hop (the standalone hostname's Cloudflare proxy) and rare on the HA
 * sidebar's local Ingress path, which is why the same GLB could fail on one
 * and not the other. An HTTP error status (404, 500, …) is deliberately NOT
 * retried — that response DID arrive, and it's a real, informative failure
 * (wrong path, nothing uploaded yet), not a transient blip; retrying it would
 * just delay the caller's existing "re-upload it" message. The caller still
 * owns that check: this returns the (possibly not-ok) Response alongside
 * whatever bytes were actually read, exactly like a single successful
 * fetch()+readWithProgress() would have.
 */
export async function fetchModelWithRetry(
  url: string,
  onProgress: (frac: number) => void,
): Promise<{ resp: Response; data: ArrayBuffer }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MODEL_FETCH_RETRIES; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return { resp, data: new ArrayBuffer(0) }; // caller classifies + reports the status; no retry
      const data = await readWithProgress(resp, onProgress);
      return { resp, data };
    } catch (err) {
      lastErr = err;
      if (attempt === MODEL_FETCH_RETRIES) break;
      devLog(`[fetchModelWithRetry] attempt ${attempt + 1} failed, retrying…`, err);
      onProgress(0); // a retry re-fetches from scratch — clear any partial progress shown
      await new Promise((r) => setTimeout(r, MODEL_FETCH_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  throw lastErr;
}
