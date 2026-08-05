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
  /** Abort the read if NO bytes arrive for this long. 0 disables. */
  stallMs = 0,
): Promise<ArrayBuffer> {
  const total = Number(resp.headers.get("Content-Length")) || 0;
  if (!resp.body || !total) return resp.arrayBuffer();
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    // A STALL watchdog, deliberately not a total-duration timeout: a big model
    // on a slow link is legitimately slow and must never be killed for it.
    // What must not be tolerated is a transfer that has stopped moving —
    // the connection stays open, nothing throws, and the retry logic below is
    // therefore never reached. Field case: an 18MB model reported
    // `fetchMs: 87385` right after an upload, with the user watching a spinner
    // for 87 seconds. Only a gap BETWEEN chunks trips this.
    const { done, value } = stallMs > 0
      ? await withStallTimeout(reader.read(), stallMs, () => void reader.cancel().catch(() => {}))
      : await reader.read();
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

/** Reject if `p` hasn't settled within `ms`, running `onTimeout` to release the
 *  underlying resource. The rejection is what puts the caller into its existing
 *  retry path — which, on a second attempt, also escalates past the service
 *  worker (see fetchModelWithRetry). */
function withStallTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`model download stalled — no data for ${Math.round(ms / 1000)}s`));
    }, ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// Retry backoff for a NETWORK-level model-fetch failure: exponential from a
// short first delay up to a capped ceiling, retried for a generous total
// wall-clock BUDGET rather than a fixed tiny attempt count. See
// fetchModelWithRetry's docstring for why the window is this wide.
const MODEL_FETCH_FIRST_DELAY_MS = 700;
const MODEL_FETCH_MAX_DELAY_MS = 8_000;
// ~2 minutes. Comfortably outlasts any realistic transient on the public hop —
// a Cloudflare blip, a `cloudflared` tunnel reconnect, or the HA add-on itself
// restarting — so the kiosk SELF-HEALS instead of dead-ending on a terminal
// "Failed to load" screen that needs a human to hit Reload. Still finite, so a
// genuine multi-minute outage eventually surfaces a real error rather than
// spinning forever with no explanation.
const MODEL_FETCH_RETRY_BUDGET_MS = 120_000;
// No BYTES for this long ⇒ the transfer is stuck, not slow. Retrying costs a
// few seconds; waiting on a dead stream costs the whole load, silently, with a
// spinner on screen and no error to explain it (the retry loop below only ever
// runs when something THROWS, and a stalled-but-open connection never does).
// Generous enough that an ordinarily slow link — which delivers chunks steadily,
// just not quickly — can never trip it: this measures the GAP between chunks,
// not the total duration.
export const MODEL_FETCH_STALL_MS = 20_000;
// Separate, shorter budget for the request itself: headers should arrive
// promptly even when the body then takes a while. Nothing had ever bounded
// this, so an add-on that accepted the connection and then went quiet left the
// load hanging with no timeout at any layer.
const MODEL_FETCH_HEADERS_MS = 30_000;

/** Query param the service worker treats as "pure network, no interception,
 *  no caching" (see public/sw.js, where it's the very first fetch-handler
 *  check). Kept in sync by name only — the two files can't import from each
 *  other, so if you rename it, rename it there too. */
const SW_BYPASS_PARAM = "vk-sw-bypass";

/** Same URL, marked so the service worker steps out of the way entirely.
 *  Query params don't affect nginx's /model/ routing (`try_files $uri`
 *  ignores the query string) and the existing ?v= stamp is preserved, so the
 *  immutable Cache-Control mapping still applies. */
function withServiceWorkerBypass(url: string): string {
  try {
    const u = new URL(url, typeof location !== "undefined" ? location.href : "http://localhost");
    u.searchParams.set(SW_BYPASS_PARAM, "1");
    return u.toString();
  } catch {
    return url; // unparseable — better to retry the plain URL than to throw
  }
}

/** Is a service worker actually mediating this page's requests? Only then is
 *  bypassing it meaningful (under Ingress none is registered at all — see
 *  main.tsx — which is exactly why the add-on path never hit this bug). */
function serviceWorkerControlsPage(): boolean {
  return typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
}

/**
 * Fetch + read a model URL with progress, riding through a NETWORK-level
 * failure — fetch() throwing, or the stream dropping mid-read
 * (readWithProgress's reader.read() throwing) — both surface as
 * "TypeError: Failed to fetch" / similar. These are common on a
 * public-internet hop (the standalone hostname's Cloudflare proxy) and rare on
 * the HA sidebar's local Ingress path, which is why the same GLB could fail on
 * one and not the other. Such a blip is almost always over within a few
 * seconds, so rather than giving up after a couple of quick tries (which
 * occasionally dead-ended a cold open on a bad few seconds), we keep retrying
 * with capped exponential backoff for MODEL_FETCH_RETRY_BUDGET_MS — the whole
 * point being that the kiosk recovers on its own the moment the hop is back,
 * with no manual reload. `onRetrying` (optional) fires before each backoff so
 * the UI can show a "reconnecting…" state instead of a frozen spinner.
 *
 * Retries also ESCALATE past the service worker (see the loop body): a
 * SW-mediated failure repeats identically forever, so plain retrying can't
 * recover from one — going around it can.
 *
 * An HTTP error status (404, 500, …) is deliberately NOT retried — that
 * response DID arrive, and it's a real, informative failure (wrong path,
 * nothing uploaded yet), not a transient blip; retrying it would just delay
 * the caller's existing "re-upload it" message. The caller still owns that
 * check: this returns the (possibly not-ok) Response alongside whatever bytes
 * were actually read, exactly like a single successful
 * fetch()+readWithProgress() would have.
 */
export async function fetchModelWithRetry(
  url: string,
  onProgress: (frac: number) => void,
  onRetrying?: (attempt: number, waitMs: number) => void,
): Promise<{ resp: Response; data: ArrayBuffer }> {
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    // Escalation: the FIRST attempt goes through the service worker normally
    // (so its model cache keeps doing its job on the happy path); every retry
    // after a failure bypasses it. A SW-mediated failure is deterministic —
    // the field bug that motivated this re-downloaded 15 MB and died the same
    // way on every attempt until the 120 s budget ran out — so retrying the
    // identical path is worthless, while going around it actually recovers.
    // Costs nothing when the SW isn't the culprit: the bypassed request is a
    // plain network fetch of the same URL.
    const attemptUrl = attempt > 0 && serviceWorkerControlsPage()
      ? withServiceWorkerBypass(url)
      : url;
    // Bound the REQUEST (headers) separately from the body read below — the
    // two fail differently and only the body one can be judged by progress.
    const ctrl = new AbortController();
    const headerTimer = setTimeout(() => ctrl.abort(), MODEL_FETCH_HEADERS_MS);
    try {
      const resp = await fetch(attemptUrl, { signal: ctrl.signal });
      clearTimeout(headerTimer);
      if (!resp.ok) return { resp, data: new ArrayBuffer(0) }; // caller classifies + reports the status; no retry
      const data = await readWithProgress(resp, onProgress, MODEL_FETCH_STALL_MS);
      return { resp, data };
    } catch (err) {
      clearTimeout(headerTimer);
      attempt++;
      // Budget spent — a genuine sustained outage, not a blip. Surface it.
      if (Date.now() - started >= MODEL_FETCH_RETRY_BUDGET_MS) throw err;
      const wait = Math.min(
        MODEL_FETCH_FIRST_DELAY_MS * 2 ** (attempt - 1),
        MODEL_FETCH_MAX_DELAY_MS,
      );
      devLog(`[fetchModelWithRetry] attempt ${attempt} failed (network), retrying in ${wait}ms…`, err);
      onProgress(0); // a retry re-fetches from scratch — clear any partial progress shown
      onRetrying?.(attempt, wait);
      await waitOrUntilOnline(wait);
    }
  }
}

/** Sit out the backoff delay — but wake up immediately if the browser itself
 *  reports connectivity restored first. Diagnosed from a real field failure:
 *  a device resuming from sleep/background can have its network stack down
 *  for well over a minute reassociating Wi-Fi/VPN/DNS, so a fixed backoff
 *  step sometimes sat idle for seconds after the network was ALREADY back,
 *  eating into the fixed retry budget for no reason. Doesn't reset or extend
 *  that budget — a flapping 'online' event on a genuinely broken connection
 *  must not make this retry forever — it only shortens the wait in the
 *  common case where the OS confirms the network is back before the timer
 *  would have fired anyway. */
function waitOrUntilOnline(ms: number): Promise<void> {
  if (typeof window === "undefined") return new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      window.removeEventListener("online", finish);
      resolve();
    }
    window.addEventListener("online", finish, { once: true });
  });
}
