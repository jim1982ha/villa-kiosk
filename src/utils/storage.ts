// src/utils/storage.ts
// IndexedDB helper for the (large) GLB model, plus tiny localStorage helpers.

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

// ── Add-on central configuration ────────────────────────────────────────────
// When model_path is set in the HA add-on options page, all clients load the
// 3D model from the add-on's /model/ endpoint (backed by HA's www folder)
// instead of each client uploading their own copy to IndexedDB.

export interface AddonConfig {
  /** Path relative to /config/www/, e.g. "villa-kiosk/villa.glb". Empty = not configured. */
  model_path: string;
  /** Optional SH3D path for central room-name loading. */
  sh3d_path: string;
}

let _addonConfigCache: AddonConfig | null = null;

/** Fetch the add-on options from the supervisor-proxy. Cached after first call. */
export async function fetchAddonConfig(): Promise<AddonConfig> {
  if (_addonConfigCache) return _addonConfigCache;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch("/addon-config", { signal: ctrl.signal });
    clearTimeout(tid);
    if (!resp.ok) throw new Error(`${resp.status}`);
    _addonConfigCache = await resp.json() as AddonConfig;
  } catch {
    // Not in an add-on context (dev mode) or add-on not yet configured.
    _addonConfigCache = { model_path: "", sh3d_path: "" };
  }
  return _addonConfigCache;
}
