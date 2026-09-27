// src/utils/localModel.ts
// The model stored in THIS browser (IndexedDB) and its small metadata record —
// the fallback before any central model exists. Split out of utils/storage.ts
// (round 10, 2.496.162), which held this, the per-device view preferences and
// the add-on's central model in one file.

import { readJson, writeJson, removeStored } from "./storedJson";


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
  writeJson(META_KEY, meta);
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
  removeStored(META_KEY);
}

export function getModelMeta(): ModelMeta | null {
  // Through storedJson: this was a bare JSON.parse on the boot path.
  return readJson<ModelMeta>(META_KEY, (v): v is ModelMeta =>
    typeof v === "object" && v !== null && typeof (v as ModelMeta).name === "string" && typeof (v as ModelMeta).size === "number");
}
