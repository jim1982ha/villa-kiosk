// src/utils/storage.ts
// IndexedDB helper for the (large) GLB model, plus tiny localStorage helpers.

import { ingressPath } from "@/ha/ingress";

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
export async function versionedModelUrl(relPath: string): Promise<string> {
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

// HA's Ingress gateway rejects any single request over ~16 MB with HTTP 413
// (a Supervisor-level cap the add-on cannot raise), so anything bigger goes up
// as sequential ~8 MB pieces the supervisor-proxy reassembles server-side.
// 12 MB single-shot threshold leaves margin under the cap.
const SINGLE_SHOT_MAX_BYTES = 12 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

async function postUploadRequest(
  query: string,
  body: Blob,
): Promise<{ path: string; size: number }> {
  const resp = await fetch(ingressPath(`model-upload?${query}`), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  if (!resp.ok) {
    let msg = `Upload failed (HTTP ${resp.status})`;
    try {
      const j = await resp.json() as { error?: string };
      if (j?.error) msg = j.error;
    } catch { /* non-JSON error body */ }
    throw new Error(msg);
  }
  return resp.json() as Promise<{ path: string; size: number }>;
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
): Promise<{ path: string; size: number }> {
  // The original filename rides along so the add-on can record WHAT was
  // uploaded (the destination file keeps the configured name forever).
  const nameQ = originalName ? `&name=${encodeURIComponent(originalName)}` : "";
  const base = `kind=${kind}${nameQ}`;

  let result: { path: string; size: number };
  if (file.size <= SINGLE_SHOT_MAX_BYTES) {
    result = await postUploadRequest(base, file);
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
      );
    }
  }
  _addonConfigCache = null;
  return result;
}

/** Fetch the effective model paths from the supervisor-proxy (/addon-config).
 *  Cached after first call. Runs after login, so the session cookie carries the
 *  authorization; a 401/failure just means "no central model yet". */
export async function fetchAddonConfig(): Promise<AddonConfig> {
  if (_addonConfigCache) return _addonConfigCache;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(ingressPath("addon-config"), { signal: ctrl.signal });
    clearTimeout(tid);
    if (!resp.ok) throw new Error(`${resp.status}`);
    _addonConfigCache = await resp.json() as AddonConfig;
  } catch {
    // No model uploaded yet, or the service is briefly unreachable.
    _addonConfigCache = { model_path: "" };
  }
  return _addonConfigCache;
}
