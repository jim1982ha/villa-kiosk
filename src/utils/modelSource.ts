// src/utils/modelSource.ts
// Which model this load shows, and what each failure means — the decision in
// BabylonCanvas's load sequence that needs no browser, with its dependencies
// passed in.
//
//   * Ask the add-on which model it holds (/addon-config). NO ANSWER is not
//     "no model": a 502 while the add-on restarts, an expired session or a
//     dropped request is retried, with the "reconnecting" notice, for as long
//     as the screen is open. It used to read as "No 3D model loaded yet" on a
//     villa that had one, until the page reloaded (2.496.254).
//   * The add-on holds a model: fetch it by its versioned URL. An HTTP status
//     is an answer ("nothing there"), not a blip: MODEL_FETCH_HTTP_<status>,
//     and the fix is a re-upload.
//   * The add-on holds none: "none" — the screen that offers the upload.
//
// ⚠️ THE PER-BROWSER MODEL IS GONE (2.496.254). Before an add-on model
// existed the app fell back to a copy kept in this browser's IndexedDB, and
// the no-model screen uploaded INTO that copy — so an owner's first upload on
// a fresh install reached only the browser it was made in. The no-model screen
// now uploads to the add-on, like Settings; a copy an older version left
// behind is deleted on every load (localModel.forgetBrowserModel).
//
// tests/oracles/model_source.mjs drives it with fakes.

import { centralModelUrl, type AddonConfig, type AddonConfigAnswer } from "./centralModel";

export type ModelSource =
  | { ok: true; data: ArrayBuffer; cfg: AddonConfig; source: string; prefetched: boolean; kept: boolean }
  | { ok: false; reason: "none" }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "http"; status: number; code: string; message: string };

export interface ModelSourceDeps {
  readAddonConfig(): Promise<AddonConfigAnswer>;
  modelBytes(url: string, onProgress: (f: number) => void, onRetrying?: () => void):
    Promise<{ ok: true; data: ArrayBuffer; prefetched: boolean; kept: boolean } | { ok: false; status: number }>;
  /** Deletes a model an older version kept in this browser, if any. */
  forgetBrowserModel(): Promise<void>;
  wait(ms: number): Promise<void>;
}

/** Between attempts to reach the add-on: quick at first (a restart takes a
 *  few seconds), then every 15 s for as long as the screen is open. */
export const ADDON_RETRY_MS = [1000, 2000, 4000, 8000, 15000];

export async function acquireModel(
  deps: ModelSourceDeps,
  hooks: {
    onProgress: (f: number) => void;
    onRetrying?: () => void;
    /** The add-on's answer, as soon as it is known and before any bytes —
     *  the caller starts the room-data read here, in the model's shadow. */
    onCentral?: (cfg: AddonConfig) => void;
    cancelled?: () => boolean;
  },
): Promise<ModelSource> {
  void deps.forgetBrowserModel();
  let answer = await deps.readAddonConfig();
  for (let attempt = 0; !answer.ok; attempt++) {
    if (hooks.cancelled?.()) return { ok: false, reason: "cancelled" };
    hooks.onRetrying?.();
    await deps.wait(ADDON_RETRY_MS[Math.min(attempt, ADDON_RETRY_MS.length - 1)]);
    if (hooks.cancelled?.()) return { ok: false, reason: "cancelled" };
    answer = await deps.readAddonConfig();
  }
  const cfg = answer.cfg;
  if (!cfg.model_path) return { ok: false, reason: "none" };
  hooks.onCentral?.(cfg);
  // Version-stamped → the service worker serves repeat opens from cache.
  const url = centralModelUrl(cfg);
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
  return { ok: true, data: got.data, cfg, source: url, prefetched: got.prefetched, kept: got.kept };
}
