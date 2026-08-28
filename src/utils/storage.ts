// src/utils/storage.ts
// IndexedDB helper for the (large) GLB model, plus tiny localStorage helpers.

import { ingressPath } from "@/ha/ingress";
import { devLog } from "@/utils/devLog";

const DB_NAME = "villa-kiosk-db";
const STORE = "models";
const MODEL_KEY = "current-model";
const META_KEY = "villa-kiosk:model-meta";

interface ModelMeta {
  name: string;
  size: number;
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveModelToIndexedDB(buf: ArrayBuffer, name = "model.glb"): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(buf, MODEL_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  const meta: ModelMeta = { name, size: buf.byteLength, savedAt: Date.now() };
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export async function loadModelFromIndexedDB(): Promise<ArrayBuffer | null> {
  const db = await openDB();
  const result = await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(MODEL_KEY);
    req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function clearStoredModel(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(MODEL_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  localStorage.removeItem(META_KEY);
}

export function getModelMeta(): ModelMeta | null {
  const raw = localStorage.getItem(META_KEY);
  return raw ? (JSON.parse(raw) as ModelMeta) : null;
}

// ── Per-device overview camera default ──────────────────────────────────────
// Deliberately NOT part of AppConfig, which is shared across devices: the
// whole reason a saved overview pose is needed is that different devices (a
// wall tablet vs. a phone in portrait) need different framing for the same
// villa. Keeping it in its own localStorage key means it always reflects
// THIS device/browser's own screen.

// ── First-run tips ───────────────────────────────────────────────────────────
// The icon-only HUD chrome plus several tap/long-press gestures (Rooms button,
// the overview "save default view" anchor) have no discovery path for someone
// using the kiosk for the first time — hover tooltips explain them, but never
// reach a touchscreen. FirstRunTips shows a one-time card covering both, gated
// per-BROWSER (not per-profile): whichever profile is first to log in on a
// given kiosk/device sees it, and it never reappears there afterward, even for
// a different profile signing in later. Simple default; villa staff can reset
// it (along with everything else per-device) by clearing site data.

const FIRST_RUN_TIPS_KEY = "villa-kiosk:first-run-tips-seen";

export function hasSeenFirstRunTips(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_TIPS_KEY) === "1";
  } catch {
    return true; // storage disabled — don't show a tips card that can never be dismissed-and-remembered
  }
}

export function markFirstRunTipsSeen(): void {
  try {
    localStorage.setItem(FIRST_RUN_TIPS_KEY, "1");
  } catch { /* storage disabled */ }
}

const OVERVIEW_VIEW_KEY = "villa-kiosk:overview-view";

export interface OverviewViewSnapshot {
  alpha: number;
  beta: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export function saveOverviewView(view: OverviewViewSnapshot): void {
  try {
    localStorage.setItem(OVERVIEW_VIEW_KEY, JSON.stringify(view));
  } catch (err) {
    console.error("[storage] failed to save overview view", err);
  }
}

export function loadOverviewView(): OverviewViewSnapshot | null {
  const raw = localStorage.getItem(OVERVIEW_VIEW_KEY);
  return raw ? (JSON.parse(raw) as OverviewViewSnapshot) : null;
}

// ── Add-on central configuration ────────────────────────────────────────────
// The 3D model is uploaded once through the kiosk's Settings and stored in the
// add-on's private /data volume; all clients load it from the add-on's /model/
// endpoint (session-gated). A per-browser IndexedDB upload is only the fallback
// before any central model exists.

export interface AddonConfig {
  /** Served path under /model/, e.g. "villa.glb". Empty = none uploaded yet. */
  model_path: string;
  /**
   * Provenance of the file currently AT model_path: a central upload
   * overwrites that file in place, so the served name never changes — this
   * records the original browser-side filename + time of the last upload
   * (null/absent when the file was placed manually or by an older add-on).
   */
  model_upload?: { original_name: string; uploaded_at: string } | null;
  /** Same provenance for the room-data sidecar (<model>.rooms.json). */
  rooms_upload?: { original_name: string; uploaded_at: string } | null;
}

/** The room-data sidecar URL that sits next to the central GLB (model_path
 *  with its .glb swapped for .rooms.json). The pipeline emits it; the app
 *  reads it instead of the old multi-hundred-MB .sh3d. */
export function roomsPathFor(modelPath: string): string {
  return modelPath.replace(/\.glb$/i, ".rooms.json");
}

// versionedModelUrl's HEAD probe (below) is the only way to detect a replaced
// file, but it's a real network round-trip on every open — over a remote
// tunnel (DuckDNS, Nabu Casa) a transient slow/dropped HEAD would otherwise
// fall back to the BARE url, which the service worker's model cache has
// never seen (every previous successful load was cached under a `?v=`
// key) — forcing a full re-download of a many-MB GLB for what's often just
// one flaky request. Remembering the last tag that worked means a failed
// probe still resolves to the SAME versioned URL as last time, so the model
// cache still hits.
const LAST_MODEL_TAG_PREFIX = "villa-kiosk:model-tag:";

// versionedModelUrl is called from at least two independent places on every
// load (main.tsx's startModelPrefetch AND BabylonCanvas's own load effect,
// each racing to resolve the SAME relPath) — each call used to fire its own
// live HEAD probe. Under a flaky/congested network, one call's probe can time
// out while the other succeeds, and the timed-out one then falls back to
// whatever tag was in localStorage — which can be a DIFFERENT tag than the
// one the other call just resolved. Two callers disagreeing on the model's
// `?v=` breaks prefetch reuse (claimPrefetch rejects on a URL mismatch,
// silently discarding an already-downloaded GLB and re-fetching from scratch)
// and fragments the floor-probe cache (keyed on this same URL) for what is
// otherwise byte-identical geometry. Memoizing per relPath — one real HEAD
// probe per page life, every other caller awaits its result — makes that
// class of mismatch structurally impossible instead of just unlikely.
const _versionedUrlCache = new Map<string, Promise<string>>();

export function versionedModelUrl(relPath: string): Promise<string> {
  let p = _versionedUrlCache.get(relPath);
  if (!p) {
    p = resolveVersionedModelUrl(relPath);
    _versionedUrlCache.set(relPath, p);
  }
  return p;
}

/**
 * Resolve a central model file (GLB/SH3D) to a version-stamped URL so the
 * service worker can cache it aggressively (cache-first) yet still pick up a
 * replaced file automatically. We HEAD the file for its ETag / Last-Modified and
 * append it as `?v=`; when the admin swaps the model the tag changes, the URL
 * changes, and the SW downloads the new bytes exactly once. Without this the
 * 34 MB GLB was re-downloaded on every open (the SW skipped it because, behind
 * Ingress, its path contains "/api/"). If the live probe fails, falls back to
 * the last tag that worked (see LAST_MODEL_TAG_PREFIX) rather than an
 * unversioned URL, so a flaky probe doesn't force a fresh download.
 */
async function resolveVersionedModelUrl(relPath: string): Promise<string> {
  // The add-on's nginx serves central files at /model/ (an alias onto the
  // add-on's /data volume, session-gated). Resolved against the base path so it
  // works both in the sidebar (Ingress prefix) and on the direct hostname.
  const url = ingressPath(`model/${relPath}`);
  const tagKey = LAST_MODEL_TAG_PREFIX + relPath;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(tid);
    if (resp.ok) {
      const tag =
        resp.headers.get("ETag") ||
        resp.headers.get("Last-Modified") ||
        resp.headers.get("Content-Length");
      if (tag) {
        const clean = tag.replace(/"/g, "");
        try { localStorage.setItem(tagKey, clean); } catch { /* storage full/disabled */ }
        return `${url}?v=${encodeURIComponent(clean)}`;
      }
    }
  } catch {
    // Offline, HEAD unsupported, or the probe timed out/dropped.
  }
  try {
    const lastTag = localStorage.getItem(tagKey);
    if (lastTag) return `${url}?v=${encodeURIComponent(lastTag)}`;
  } catch { /* storage disabled */ }
  return url;
}

let _addonConfigCache: AddonConfig | null = null;

/** Drop the cached add-on config so the next fetchAddonConfig() re-reads it
 *  (e.g. right after a central upload changes the effective paths). */
export function clearAddonConfigCache(): void {
  _addonConfigCache = null;
}

/** Drop every memoized versionedModelUrl() result — call alongside
 *  clearAddonConfigCache() right after a central upload, so the next resolve
 *  does a real HEAD probe instead of replaying the pre-upload tag/URL for the
 *  rest of this page's life. */
export function clearVersionedModelUrlCache(): void {
  _versionedUrlCache.clear();
}

// HA's Ingress gateway rejects any single request over ~16 MB with HTTP 413
// (a Supervisor-level cap the add-on cannot raise), so anything bigger goes up
// as sequential ~8 MB pieces the supervisor-proxy reassembles server-side.
// 12 MB single-shot threshold leaves margin under the cap.
const SINGLE_SHOT_MAX_BYTES = 12 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/** Per-attempt ceiling, ESCALATING. It exists to turn a HUNG request into a
 *  readable error rather than to police speed — without it a stalled chunk left
 *  the button reading "Uploading…" forever with nothing logged and no way to
 *  tell a slow upload from a dead one.
 *
 *  Why it escalates instead of sitting at one generous value: a field capture
 *  showed the first chunk stall at `offset=0` with ZERO bytes moved, our own
 *  AbortController cancel it at the two-minute mark, and a manual retry then
 *  complete in 920 ms. A flat 120 s meant every blip on the public hop cost two
 *  minutes of a `0%` badge and a human deciding to try again.
 *
 *  The first attempt is short enough that a blip is noticed in well under a
 *  minute, and the LAST is the old generous value so a genuinely slow uplink
 *  still finishes. The floor that first number assumes is ~1.5 Mbit/s up for an
 *  8 MB chunk; below that the first attempt is abandoned and re-sent, which
 *  costs bandwidth but not the upload. Erring the other way — one long
 *  timeout — costs the two minutes this exists to remove. */
const UPLOAD_ATTEMPT_TIMEOUTS_MS = [45_000, 90_000, 120_000];
/** Between attempts. Short: the failure being retried is a stalled connection,
 *  not a rate limit, and the attempt itself already waited a long time. */
const UPLOAD_RETRY_DELAY_MS = [700, 2_000];

/** An error the connection caused, as opposed to an answer the server gave.
 *  Only this kind is retried — see postUploadRequest. */
class TransientUploadError extends Error {}

async function postUploadOnce(
  query: string, body: Blob, timeoutMs: number,
): Promise<{ path: string; size: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(ingressPath(`model-upload?${query}`), {
      method: "POST",
      // ⚠️ STATED, NOT INHERITED (/dry-audit, 2026-08-28). Same-origin is
      // `fetch`'s default, so this owner-only upload has always been
      // authorised — but it was the one mutating call in the app that said so
      // nowhere, which makes a reviewer work out a browser default to know the
      // session is attached. It cannot use `postJson`: the body is a binary
      // Blob and the content type is not JSON.
      credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream" },
      body,
      signal: ctl.signal,
    });
  } catch (e) {
    throw new TransientUploadError(
      (e as Error)?.name === "AbortError"
        ? `Upload stalled — no response from the add-on within ${timeoutMs / 1000}s.`
        : `Upload failed: ${(e as Error)?.message || "network error"}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    let msg = `Upload failed (HTTP ${resp.status})`;
    try {
      const j = await resp.json() as { error?: string };
      if (j?.error) msg = j.error;
    } catch { /* non-JSON error body */ }
    // NOT transient: a 413/401/500 is an ANSWER — the file is too big, the
    // session expired, the add-on refused it. Re-sending 8 MB to be told the
    // same thing three times helps nobody and delays the real message. Same
    // rule fetchModelWithRetry applies to a non-ok download.
    throw new Error(msg);
  }
  return resp.json() as Promise<{ path: string; size: number }>;
}

/**
 * One chunk, retried through a stalled connection.
 *
 * Retrying is SAFE because the chunk protocol is idempotent: the server keys a
 * partial upload by `upload_id` and writes each piece at its own `offset`, so
 * re-sending the same piece overwrites the same bytes. That is what makes this
 * a retry rather than a corruption risk, and it is why the wrapper lives here —
 * around the request that carries those two parameters — rather than around the
 * whole file.
 */
async function postUploadRequest(
  query: string,
  body: Blob,
  /** Fires before each backoff, so the UI can say "retrying" instead of
   *  freezing at the same percentage with no explanation. */
  onRetry?: (attempt: number, of: number) => void,
): Promise<{ path: string; size: number }> {
  const attempts = UPLOAD_ATTEMPT_TIMEOUTS_MS.length;
  for (let i = 0; ; i++) {
    try {
      return await postUploadOnce(query, body, UPLOAD_ATTEMPT_TIMEOUTS_MS[i]);
    } catch (e) {
      if (!(e instanceof TransientUploadError) || i >= attempts - 1) {
        // Out of attempts on a transient failure: say what was actually tried,
        // because "it stalled" and "it stalled three times over three minutes"
        // are different problems for whoever reads it.
        if (e instanceof TransientUploadError) {
          throw new Error(`${e.message} Gave up after ${attempts} attempts.`);
        }
        throw e;
      }
      devLog(`[uploadCentralModel] attempt ${i + 1}/${attempts} stalled, retrying…`, e);
      onRetry?.(i + 1, attempts);
      await new Promise((r) => setTimeout(r, UPLOAD_RETRY_DELAY_MS[i]));
    }
  }
}

/**
 * Upload a central model file (GLB or room-data sidecar) to the add-on, which
 * writes it into its own /data store (overwriting the previous one) via the
 * supervisor-proxy's /model-upload endpoint. Returns the resolved path.
 * Invalidates the addon-config cache so the freshly-uploaded model is picked up
 * on the next fetch. Takes a Blob so a caller can upload a re-packaged Blob if
 * needed. Files above ~12 MB go up via the chunked protocol.
 */
export async function uploadCentralModel(
  file: Blob,
  kind: "glb" | "rooms",
  originalName?: string,
  /** Called as each chunk lands, so a multi-chunk upload can show real
   *  progress. A 19 MB GLB is three round trips; without this the UI cannot
   *  distinguish "chunk 2 of 3 in flight" from "wedged". */
  onProgress?: (sentBytes: number, totalBytes: number) => void,
  /** Called when a chunk stalled and is being re-sent — see postUploadRequest. */
  onRetry?: (attempt: number, of: number) => void,
): Promise<{ path: string; size: number }> {
  // The original filename rides along so the add-on can record WHAT was
  // uploaded (the destination file keeps the configured name forever).
  const nameQ = originalName ? `&name=${encodeURIComponent(originalName)}` : "";
  const base = `kind=${kind}${nameQ}`;

  let result: { path: string; size: number };
  if (file.size <= SINGLE_SHOT_MAX_BYTES) {
    result = await postUploadRequest(base, file, onRetry);
    onProgress?.(file.size, file.size);
  } else {
    const uploadId =
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}0000`;
    result = { path: "", size: 0 };
    for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
      const piece = file.slice(offset, offset + UPLOAD_CHUNK_BYTES);
      const last = offset + UPLOAD_CHUNK_BYTES >= file.size;
      result = await postUploadRequest(
        `${base}&upload_id=${uploadId}&offset=${offset}${last ? "&last=1" : ""}`,
        piece,
        onRetry,
      );
      onProgress?.(Math.min(offset + UPLOAD_CHUNK_BYTES, file.size), file.size);
    }
  }
  _addonConfigCache = null;
  return result;
}

/** Fetch the effective model paths from the supervisor-proxy (/addon-config).
 *  Cached after first SUCCESSFUL call (see below for why a failure isn't
 *  cached). Runs after login, so the session cookie carries the authorization;
 *  a 401/failure just means "no central model yet" — OR, since v2.28.0's
 *  background model prefetch (see utils/modelPrefetch.ts) calls this from the
 *  profile-select screen, BEFORE login on the direct/Cloudflare-gated
 *  deployment, where /addon-config is genuinely unauthorized (401) until a
 *  session cookie exists. Caching that early 401 as "no model" would
 *  permanently poison the REAL post-login call in BabylonCanvas — a model
 *  that actually exists would show "no model" for the rest of the session.
 *  Only a genuine 200 (even one reporting an empty model_path) is cached. */
export async function fetchAddonConfig(): Promise<AddonConfig> {
  if (_addonConfigCache) return _addonConfigCache;
  // A NETWORK-level failure here (fetch throwing, or our own abort timeout on a
  // slow public hop) is transient — the SAME Cloudflare-hop blip that used to
  // dead-end the model download (see fetchModelWithRetry) can hit this gateway
  // call too, and when it did the whole load silently misrouted to the "no
  // model — upload one" screen even though a model actually exists. Retry those
  // a couple of times. An HTTP non-ok RESPONSE is deliberately NOT retried: a
  // 401 here is the expected, correct "not authorized yet" signal the
  // pre-login prefetch relies on (see this function's docstring +
  // modelPrefetch), and any other status is a real answer, not a blip — both
  // just mean "no central model right now" and return empty immediately, with
  // zero added latency on that (common, pre-login) path.
  const ATTEMPTS = 3;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 3000);
      let resp: Response;
      try {
        resp = await fetch(ingressPath("addon-config"), { signal: ctrl.signal });
      } finally {
        clearTimeout(tid);
      }
      if (!resp.ok) return { model_path: "" }; // real answer (often an expected 401) — not a blip
      const cfg = await resp.json() as AddonConfig;
      _addonConfigCache = cfg;
      return cfg;
    } catch {
      // Network throw / abort timeout — transient. Short backoff, then retry;
      // never cached, so a still-failing gateway just falls back to empty and a
      // later call (e.g. the daily auto-reload, or a manual retry) tries again.
      if (attempt < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return { model_path: "" };
}
