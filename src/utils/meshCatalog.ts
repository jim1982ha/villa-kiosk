// src/utils/meshCatalog.ts
// Persist the list of bindable mesh names from the loaded GLB so the Config page
// (a separate route, no live SceneManager) can offer them for binding.

import { readJson, writeJson } from "./storedJson";
const KEY = "villa-kiosk:mesh-catalog";

export function saveMeshCatalog(names: string[]): void {
  writeJson(KEY, names);
}

export function loadMeshCatalog(): string[] {
  return readJson<string[]>(KEY, (v): v is string[] => Array.isArray(v) && v.every((n) => typeof n === "string")) ?? [];
}
