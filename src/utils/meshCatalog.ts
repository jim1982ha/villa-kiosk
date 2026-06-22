// src/utils/meshCatalog.ts
// Persist the list of bindable mesh names from the loaded GLB so the Config page
// (a separate route, no live SceneManager) can offer them for binding.

const KEY = "villa-kiosk:mesh-catalog";

export function saveMeshCatalog(names: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(names));
  } catch {
    /* ignore quota errors */
  }
}

export function loadMeshCatalog(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
