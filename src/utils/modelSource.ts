// src/utils/modelSource.ts
// Where the villa's model comes from on this load, and what each failure
// means — the one decision in BabylonCanvas's load sequence that needs no
// browser, taken out of it with its dependencies passed in.
//
//   * The add-on holds a central model (addon-config's model_path): ONLY that
//     model — no per-browser fallback; a per-browser upload is irrelevant once
//     a central one exists. An HTTP status is an answer ("nothing there"),
//     not a blip: MODEL_FETCH_HTTP_<status>, and the fix is a re-upload.
//   * No central model: this browser's own IndexedDB upload, if it still has
//     the bytes. A browser can evict the (large) GLB and keep the tiny meta
//     record, leaving the app claiming a stored model that no longer exists —
//     the stale meta is cleared so Settings and the no-model screen agree.
//   * Neither: "none" — the explanatory no-model screen, never a blank scene.
//
// ⚠️ IT WAS INLINE IN A ~600-LINE React EFFECT (round 11, 2.496.172), where
// the only test was a regex over the component's source.
// tests/oracles/model_source.mjs drives it with fakes.

export type ModelSource =
  | { ok: true; data: ArrayBuffer; fromAddon: boolean; source: string; prefetched: boolean }
  | { ok: false; reason: "none" }
  | { ok: false; reason: "http"; status: number; code: string; message: string };

export interface ModelSourceDeps {
  versionedModelUrl(path: string): Promise<string>;
  modelBytes(url: string, onProgress: (f: number) => void, onRetrying?: () => void):
    Promise<{ ok: true; data: ArrayBuffer; prefetched: boolean } | { ok: false; status: number }>;
  fromIndexedDB(): Promise<ArrayBuffer | null>;
  hasStoredMeta(): boolean;
  clearStoredModel(): Promise<void>;
}

export async function acquireModel(
  modelPath: string | undefined | null,
  deps: ModelSourceDeps,
  hooks: { onProgress: (f: number) => void; onRetrying?: () => void; onCentral?: (path: string) => void },
): Promise<ModelSource> {
  if (modelPath) {
    hooks.onCentral?.(modelPath);
    // Version-stamped → the service worker serves repeat opens from cache.
    const url = await deps.versionedModelUrl(modelPath);
    // The profile screen's background download when it is for this URL,
    // else a fresh fetch that rides through network blips.
    const got = await deps.modelBytes(url, hooks.onProgress, hooks.onRetrying);
    if (!got.ok) {
      return {
        ok: false, reason: "http", status: got.status, code: `MODEL_FETCH_HTTP_${got.status}`,
        message: `Central model not found at ${url} (HTTP ${got.status}).\n`
          + "Re-upload it from Settings → Advanced Settings (Owner profile).",
      };
    }
    return { ok: true, data: got.data, fromAddon: true, source: url, prefetched: got.prefetched };
  }
  const data = await deps.fromIndexedDB();
  if (!data) {
    if (deps.hasStoredMeta()) await deps.clearStoredModel();
    return { ok: false, reason: "none" };
  }
  return { ok: true, data, fromAddon: false, source: "(per-browser IndexedDB upload)", prefetched: false };
}
