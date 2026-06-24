// src/utils/backup.ts
// Export/import the full config (and optionally the GLB) as a ZIP. (3Dash idea.)

import JSZip from "jszip";
import type { AppConfig } from "@/config/AppConfig";
import { loadModelFromIndexedDB, saveModelToIndexedDB, getModelMeta } from "./storage";

const CONFIG_ENTRY = "config.json";
const MODEL_ENTRY = "model.glb";

/** Build a ZIP Blob containing config.json (+ model.glb if requested). */
export async function exportBackup(config: AppConfig, includeModel = true): Promise<Blob> {
  const zip = new JSZip();
  // Never leak the long-lived token into a backup that might be shared.
  const safe: AppConfig = { ...config, haToken: "" };
  zip.file(CONFIG_ENTRY, JSON.stringify(safe, null, 2));

  if (includeModel) {
    const model = await loadModelFromIndexedDB();
    if (model) zip.file(MODEL_ENTRY, model);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export interface ImportResult {
  config: Partial<AppConfig> | null;
  modelImported: boolean;
}

/** Restore from a ZIP: returns parsed config, and loads the GLB into IndexedDB. */
export async function importBackup(file: File): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  let config: Partial<AppConfig> | null = null;
  let modelImported = false;

  const cfgFile = zip.file(CONFIG_ENTRY);
  if (cfgFile) {
    try {
      config = JSON.parse(await cfgFile.async("string")) as Partial<AppConfig>;
    } catch {
      throw new Error("Backup is corrupt: config.json is not valid JSON.");
    }
  }

  const modelFile = zip.file(MODEL_ENTRY);
  if (modelFile) {
    const buf = await modelFile.async("arraybuffer");
    await saveModelToIndexedDB(buf, getModelMeta()?.name ?? "model.glb");
    modelImported = true;
  }
  return { config, modelImported };
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
