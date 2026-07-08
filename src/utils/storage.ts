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
// Deliberately NOT part of AppConfig: AppConfig is exported/imported as part
// of a backup (see utils/backup.ts) and shared across devices that way, but
// the whole reason a saved overview pose is needed is that different devices
// (a wall tablet vs. a phone in portrait) need different framing for the same
// villa. Keeping it in its own localStorage key means it never travels with a
// backup restore and always reflects THIS device/browser's own screen.

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
// When model_path is set in the HA add-on options page, all clients load the
// 3D model from the add-on's /model/ endpoint (backed by HA's www folder)
// instead of each client uploading their own copy to IndexedDB.

export interface AddonConfig {
  /** Path relative to /config/www/, e.g. "villa-kiosk/villa.glb". Empty = not configured. */
  model_path: string;
  /** Optional SH3D path for central room-name loading. */
  sh3d_path: string;
  /**
   * Provenance of the file currently AT model_path: a central upload
   * overwrites that file in place, so the served name never changes — this
   * records the original browser-side filename + time of the last upload
   * (null/absent when the file was placed manually or by an older add-on).
   */
  model_upload?: { original_name: string; uploaded_at: string } | null;
  /** Same provenance for the sh3d_path file. */
  sh3d_upload?: { original_name: string; uploaded_at: string } | null;
}

/**
 * Resolve a central model file (GLB/SH3D) to a version-stamped URL so the
 * service worker can cache it aggressively (cache-first) yet still pick up a
 * replaced file automatically. We HEAD the file for its ETag / Last-Modified and
 * append it as `?v=`; when the admin swaps the model the tag changes, the URL
 * changes, and the SW downloads the new bytes exactly once. Without this the
 * 34 MB GLB was re-downloaded on every open (the SW skipped it because, behind
 * Ingress, its path contains "/api/"). Falls back to the plain URL on any error.
 */
export async function versionedModelUrl(relPath: string): Promise<string> {
  const url = ingressPath(`model/${relPath}`);
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
      if (tag) return `${url}?v=${encodeURIComponent(tag.replace(/"/g, ""))}`;
    }
  } catch {
    // Offline, or HEAD unsupported — fall back to the unversioned URL.
  }
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
 * Upload a central model file (GLB or SH3D) to the add-on, which writes it into
 * the HA www folder (overwriting the previous one). Only meaningful in add-on
 * (Ingress) mode; the supervisor-proxy backs the /model-upload endpoint.
 * Returns the resolved www-relative path. Invalidates the addon-config cache so
 * a freshly-uploaded managed default is picked up on the next fetch.
 * Takes a Blob (not just File) so a caller can upload a re-packaged Blob
 * (e.g. sh3dParser's minifySh3d) instead of the original file as-is.
 * Requires add-on ≥ 2.9.6 for files above ~12 MB (chunked protocol).
 */
export async function uploadCentralModel(
  file: Blob,
  kind: "glb" | "sh3d",
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

/** Fetch the add-on options from the supervisor-proxy. Cached after first call. */
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
    // Not in an add-on context (dev mode) or add-on not yet configured.
    _addonConfigCache = { model_path: "", sh3d_path: "" };
  }
  return _addonConfigCache;
}
