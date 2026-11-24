// src/utils/modelLifecycle.ts
// THE villa model and its state, in one place: the add-on's answer (which
// model, which version), its download (including the background one started on
// the profile screen), how this load ended, and "the model was replaced".
//
// Until this module that state lived in six places: a cached answer
// in centralModel, the prefetch globals in modelPrefetch, the loaded-model
// fingerprint in modelInfo, five useStates inside BabylonCanvas's mount effect,
// Dashboard's `modelKey` bumped to remount the canvas, and useGlbUpload's own
// copy of the answer plus a fixed "clear cache, re-read, wait 600 ms, reload".
// None of them could see a load that never ended: a 125 MB model (geometry not
// compressed) left every screen on "Loading the villa…" for ever (owner,
// 2026-11-16).
//
// The outcomes, each a screen of its own (ModelState):
//   * loading (with its progress) / reconnecting: the add-on did not answer,
//     or the download is riding through a blip. NO ANSWER IS NOT "NO MODEL":
//     it is retried for as long as the screen is open (2.496.254: it used to
//     read as "No 3D model loaded yet" on a villa that had one).
//   * none: the add-on holds no model, the screen that offers the upload.
//   * too-heavy: the model is bigger than MODEL_TOO_HEAVY_BYTES (known from the
//     add-on's version stamp before any byte moves, else from the download's
//     length, else from the bytes), or its unpack has not finished after
//     MODEL_UNPACK_LIMIT_MS. Never a spinner for ever.
//   * error: an HTTP status for the model is an answer ("nothing there", the
//     fix is a re-upload), a sustained outage after the download's own retry
//     budget, or the 3D view refusing the file.
//   * ready.
//
// "Replaced" (an upload landed): one fresh read of the add-on's answer, and
// when the model's or its room data's version moved, exactly ONE reload: the
// generation goes up and the canvas, keyed on it, builds a new scene. A new
// scene and not a second model in the old one: SceneManager.loadModel adds
// meshes to its scene and has no "unload", so a fresh SceneManager is the only
// clean way to show another file (and frees the old one's memory).
//
// Everything a browser provides is passed in (createModelLifecycle's deps), so
// tests/oracles/model_lifecycle.mjs drives it in node; `modelLifecycle` below is
// the page's one instance, wired to the real fetches.

import { useSyncExternalStore } from "react";
import { centralModelUrl, readAddonConfig, type AddonConfig, type AddonConfigAnswer } from "./centralModel";
import { fetchModelWithRetry } from "./fetchProgress";
import { keepModel, keptModel } from "./modelCache";
import { forgetBrowserModel } from "./localModel";
import type { LoadedModelInfo } from "./modelInfo";
import { fmtBytes } from "./modelUpload";
import { fmtDuration } from "@/components/panels/chartUtils";

/**
 * Above this size the model is not loaded: the "too heavy" screen says so,
 * with its size, instead of a spinner that never ends.
 *
 * 60 MB, three times the owner's normal model (about 20 MB, its geometry
 * Draco-compressed, its textures WebP) and half the 125 MB file that never
 * finished. What a model costs a device is not its file but what it unpacks
 * to: uncompressed geometry is several times its Draco form once on the GPU,
 * and an iPad or iPhone tab is killed at a memory limit a computer never meets
 * (diagnostics' crash-loop screen is that kill). Room to grow a normal model,
 * none for one exported without compression. Size only: a slow link never
 * makes a 20 MB model "too heavy", it only takes longer.
 */
export const MODEL_TOO_HEAVY_BYTES = 60_000_000;

/**
 * The unpack (Babylon's import of bytes already in hand) still not finished
 * after this long reads as too heavy too, with the size shown. Generous: the
 * slowest normal unpack measured is about 13s on a phone, and the download is
 * never counted here (a slow link is not a heavy model).
 */
export const MODEL_UNPACK_LIMIT_MS = 180_000;

/** Between attempts to reach the add-on: quick at first (a restart takes a
 *  few seconds), then every 15 s for as long as the screen is open. */
export const ADDON_RETRY_MS = [1000, 2000, 4000, 8000, 15000];

export type ModelState =
  | { kind: "loading"; progress: number }
  | { kind: "reconnecting"; progress: number }
  | { kind: "ready" }
  | { kind: "none" }
  /** `bytes` null only when nothing said the size; `slow`: the unpack ran past MODEL_UNPACK_LIMIT_MS. */
  | { kind: "too-heavy"; bytes: number | null; slow: boolean }
  /** `addon`: the add-on's own answer for the model was an error (fix the add-on, not the file). */
  | { kind: "error"; code: string; message: string; addon: boolean };

/** The "too heavy" screen's title. ⚠️ A SLOW UNPACK IS THE DEVICE, NOT THE FILE (owner, 2026-11-24: a TV gave up on
 *  the villa's 28 MB model that a laptop opens in 4 s, and was told to export the model again): a model under the
 *  size limit that is still unpacking is a device too slow for it, and no upload helps. */
export function tooHeavyTitle(state: Extract<ModelState, { kind: "too-heavy" }>): string {
  return state.slow ? "This device is too slow to show the 3D villa." : "This 3D model is too heavy to load.";
}

/** The "too heavy" screen's line: the model's size against the limit, or how
 *  long its unpack ran, both from their constants (modelLifecycle). */
export function tooHeavyLine(state: Extract<ModelState, { kind: "too-heavy" }>): string {
  const size = state.bytes !== null ? fmtBytes(state.bytes) : null;
  if (state.slow) {
    return `It was still unpacking the villa's model${size ? ` (${size})` : ""} after ${fmtDuration(MODEL_UNPACK_LIMIT_MS)}. `
      + "It opens on a faster device.";
  }
  return `It is ${size ?? "too big"}. The VESTA UI loads models up to ${fmtBytes(MODEL_TOO_HEAVY_BYTES)}.`;
}

export interface ModelSnapshot {
  /** Goes up by one per reload; the canvas builds its scene once per value. */
  generation: number;
  state: ModelState;
  /** The add-on's last answer, null before one arrived. */
  addon: AddonConfig | null;
  /** Fingerprint of the model on screen (Settings › Advanced), null before. */
  loaded: LoadedModelInfo | null;
}

type Bytes = { ok: true; data: ArrayBuffer; kept: boolean } | { ok: false; status: number };

export interface ModelLifecycleDeps {
  /** One ask of the add-on, uncached; only a 200 is an answer. */
  readAddonConfig(): Promise<AddonConfigAnswer>;
  /** The model file's URL from an answer (version-stamped, see centralModel.modelUrl). */
  urlFor(cfg: AddonConfig): string;
  /** The bytes at `url`: this device's kept copy, else a download with its own
   *  retries (throws after a sustained outage). `onSize` reports the length the
   *  download announced, as soon as it is known. */
  getBytes(url: string, hooks: {
    onProgress(f: number): void; onRetrying(): void; onSize(bytes: number): void;
  }): Promise<Bytes>;
  /** Deletes a model an older version kept in this browser, if any. */
  forgetBrowserModel(): Promise<void>;
  wait(ms: number): Promise<void>;
  /** A one-shot timer; returns its cancel. */
  setTimer(fn: () => void, ms: number): () => void;
}

/** What a load hands back to the canvas: on success what it needs for its
 *  telemetry and the fingerprint; otherwise only whether to report an error. */
export type LoadOutcome<P> =
  | { ok: true; result: P; cfg: AddonConfig; url: string; data: ArrayBuffer; prefetched: boolean; kept: boolean }
  | { ok: false; reason: "cancelled" | "none" | "too-heavy" }
  | { ok: false; reason: "error"; code: string; error: unknown };

export interface ModelLifecycle {
  snapshot(): ModelSnapshot;
  subscribe(fn: () => void): () => void;
  /** Start the background download if the add-on already holds a model; safe to
   *  call repeatedly, never throws (before sign-in it finds no answer and stays
   *  ready to try again). Only the bytes: decoding before sign-in was dropped in
   *  v2.79.0 (a running decode cannot pause, and the passcode pad lost digits). */
  prefetch(): void;
  /** The add-on's answer for a reader to whom no answer and no model are the
   *  same thing (Settings' model info): `{model_path: ""}` when unreachable. */
  addonConfig(): Promise<AddonConfig>;
  /** One load of the current model. `parse` is the 3D view's unpack of the
   *  bytes (it may throw); `onCentral` fires with the add-on's answer before
   *  any byte, for work that can run in the download's shadow. The state
   *  follows the load; a load from an older generation, or `cancelled`, stops
   *  touching it. */
  load<P>(
    parse: (data: ArrayBuffer, url: string, cfg: AddonConfig) => Promise<P>,
    hooks?: { onCentral?(cfg: AddonConfig): void; cancelled?(): boolean },
  ): Promise<LoadOutcome<P>>;
  /** The model on screen was unpacked: its fingerprint, for Settings. */
  noteLoaded(info: LoadedModelInfo): void;
  /** A model or its room data was uploaded: re-read the add-on and, when a
   *  version moved (or the add-on did not answer), reload exactly once. */
  replaced(): Promise<void>;
}

/** The file size an add-on version stamp carries ("<mtime hex>-<size hex>",
 *  nginx's ETag form, see supervisor-proxy's _file_version), null without one. */
export function sizeFromVersion(version: string | null | undefined): number | null {
  const m = /^[0-9a-f]+-([0-9a-f]+)$/i.exec(version ?? "");
  return m ? parseInt(m[1], 16) : null;
}

const versionKey = (cfg: AddonConfig | null): string =>
  cfg ? `${cfg.model_path}|${cfg.model_version ?? ""}|${cfg.rooms_version ?? ""}` : "";

interface Prefetch {
  url: string;
  promise: Promise<Bytes>;
  progress: number;
  size: number | null;
  listeners: Set<(f: number) => void>;
  retryListeners: Set<() => void>;
}

export function createModelLifecycle(deps: ModelLifecycleDeps): ModelLifecycle {
  let snap: ModelSnapshot = { generation: 0, state: { kind: "loading", progress: 0 }, addon: null, loaded: null };
  const subs = new Set<() => void>();
  const set = (patch: Partial<ModelSnapshot>) => {
    snap = { ...snap, ...patch };
    subs.forEach((fn) => fn());
  };
  /** The versions the current generation is showing (or loading). */
  let shownKey = "";
  let prefetching = false;
  /** A download of the current model has begun (background or the load's own):
   *  a later prefetch() (a profile switch over the villa) must not start another. */
  let started = false;
  let entry: Prefetch | null = null;

  /** Cached after the first 200 (even one reporting no model); a failure never
   *  is, so an early 401 before sign-in cannot poison the call after it. One
   *  ask at a time: the prefetch started before the page mounts and the load
   *  share it, so the prefetch's download exists by the time the load looks. */
  let asking: Promise<AddonConfigAnswer> | null = null;
  const answer = (): Promise<AddonConfigAnswer> => {
    if (snap.addon) return Promise.resolve({ ok: true, cfg: snap.addon });
    asking ??= deps.readAddonConfig().then((got) => {
      if (got.ok) set({ addon: got.cfg });
      return got;
    }).finally(() => { asking = null; });
    return asking;
  };

  const tooHeavy = (bytes: number | null) => bytes !== null && bytes > MODEL_TOO_HEAVY_BYTES;

  const prefetch = () => {
    if (prefetching || started) return;
    prefetching = true;
    void answer().then((got) => {
      if (!got.ok || !got.cfg.model_path || tooHeavy(sizeFromVersion(got.cfg.model_version))) return;
      const url = deps.urlFor(got.cfg);
      const e: Prefetch = {
        url, progress: 0, size: null, listeners: new Set(), retryListeners: new Set(),
        promise: null as unknown as Promise<Bytes>,
      };
      e.promise = deps.getBytes(url, {
        onProgress: (f) => { e.progress = f; e.listeners.forEach((l) => l(f)); },
        onRetrying: () => e.retryListeners.forEach((l) => l()),
        onSize: (n) => { e.size = n; },
      });
      // A failed background download must never block a later try, nor
      // surface as an unhandled rejection when nobody claims it.
      const failed = () => { if (entry === e) { entry = null; started = false; } };
      e.promise.then((b) => { if (!b.ok) failed(); }, failed);
      entry = e;
      started = true;
    }).catch(() => {}).finally(() => { prefetching = false; });
  };

  /** The background download for this exact URL, at most once; an entry for
   *  another URL (the model was replaced since) is dropped so its bytes GC. */
  const claim = (url: string): Prefetch | null => {
    const e = entry;
    entry = null;
    return e && e.url === url ? e : null;
  };

  const load: ModelLifecycle["load"] = async (parse, hooks = {}) => {
    const gen = snap.generation;
    const stale = () => gen !== snap.generation || !!hooks.cancelled?.();
    const state = (s: ModelState) => { if (!stale()) set({ state: s }); };
    let progress = 0;
    let heavy: number | null = null; // set once the size says too heavy
    const onProgress = (f: number) => {
      progress = f;
      if (heavy === null) state(f > 0 || snap.state.kind !== "reconnecting" ? { kind: "loading", progress: f } : snap.state);
    };
    const onRetrying = () => { if (heavy === null) state({ kind: "reconnecting", progress }); };
    const stopHeavy = (bytes: number) => { heavy = bytes; state({ kind: "too-heavy", bytes, slow: false }); };
    const onSize = (n: number) => { if (tooHeavy(n)) stopHeavy(n); };
    let code = "MODEL_LOAD_FAILED";
    state({ kind: "loading", progress: 0 });
    try {
      void deps.forgetBrowserModel().catch(() => {});
      let got = await answer();
      for (let attempt = 0; !got.ok; attempt++) {
        if (stale()) return { ok: false, reason: "cancelled" };
        onRetrying();
        await deps.wait(ADDON_RETRY_MS[Math.min(attempt, ADDON_RETRY_MS.length - 1)]);
        if (stale()) return { ok: false, reason: "cancelled" };
        got = await answer();
      }
      const cfg = got.cfg;
      if (stale()) return { ok: false, reason: "cancelled" };
      if (snap.state.kind === "reconnecting") state({ kind: "loading", progress: 0 }); // the add-on answered
      shownKey = versionKey(cfg);
      if (!cfg.model_path) { state({ kind: "none" }); return { ok: false, reason: "none" }; }
      hooks.onCentral?.(cfg);
      // Known before any byte moves: nothing is downloaded at all.
      const stamped = sizeFromVersion(cfg.model_version);
      if (tooHeavy(stamped)) { stopHeavy(stamped!); return { ok: false, reason: "too-heavy" }; }
      const url = deps.urlFor(cfg);
      started = true;
      const claimed = claim(url);
      let bytes: Bytes | null = null;
      let prefetched = false;
      if (claimed) {
        onProgress(claimed.progress);
        if (claimed.size !== null) onSize(claimed.size);
        claimed.listeners.add(onProgress);
        claimed.retryListeners.add(onRetrying);
        try {
          const b = heavy === null ? await claimed.promise : null;
          if (b?.ok) { bytes = b; prefetched = true; }
        } catch { /* the background download failed: fetch afresh below */ } finally {
          claimed.listeners.delete(onProgress);
          claimed.retryListeners.delete(onRetrying);
        }
      }
      if (heavy === null && !bytes) bytes = await deps.getBytes(url, { onProgress, onRetrying, onSize });
      if (stale()) return { ok: false, reason: "cancelled" };
      if (heavy !== null) return { ok: false, reason: "too-heavy" };
      if (!bytes!.ok) {
        const status = bytes!.status;
        code = `MODEL_FETCH_HTTP_${status}`;
        const message = `Central model not found at ${url} (HTTP ${status}).\n`
          + "Re-upload it from Settings › Advanced Settings (Owner profile).";
        state({ kind: "error", code, message, addon: true });
        return { ok: false, reason: "error", code, error: new Error(message) };
      }
      const { data, kept } = bytes!;
      if (tooHeavy(data.byteLength)) { stopHeavy(data.byteLength); return { ok: false, reason: "too-heavy" }; }
      state({ kind: "loading", progress: 1 });
      // Long past any normal unpack: say so with the size instead of spinning.
      // A late finish still shows the villa (ready replaces this screen).
      const cancelGuard = deps.setTimer(
        () => state({ kind: "too-heavy", bytes: data.byteLength, slow: true }), MODEL_UNPACK_LIMIT_MS);
      let result;
      try {
        result = await parse(data, url, cfg);
      } finally {
        cancelGuard();
      }
      if (stale()) return { ok: false, reason: "cancelled" };
      state({ kind: "ready" });
      return { ok: true, result, cfg, url, data, prefetched, kept };
    } catch (error) {
      if (stale()) return { ok: false, reason: "cancelled" };
      const message = (error as Error)?.message ?? String(error);
      state({ kind: "error", code, message, addon: false });
      return { ok: false, reason: "error", code, error };
    }
  };

  const replaced = async () => {
    const got = await deps.readAddonConfig();
    if (got.ok && versionKey(got.cfg) === shownKey && snap.state.kind === "ready") {
      set({ addon: got.cfg });
      return; // nothing this screen shows has changed
    }
    entry = null;
    started = false;
    set({
      addon: got.ok ? got.cfg : null,
      generation: snap.generation + 1,
      state: { kind: "loading", progress: 0 },
      loaded: null,
    });
  };

  return {
    snapshot: () => snap,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    prefetch,
    addonConfig: async () => {
      const got = await answer();
      return got.ok ? got.cfg : { model_path: "" };
    },
    load,
    noteLoaded: (info) => set({ loaded: info }),
    replaced,
  };
}

// ── The page's one instance ──────────────────────────────────────────────────

async function getBytes(url: string, hooks: Parameters<ModelLifecycleDeps["getBytes"]>[1]): Promise<Bytes> {
  // Under the villa's system no service worker keeps the model: this device's
  // own copy does (modelCache), read before any download.
  const kept = await keptModel(url);
  if (kept) {
    hooks.onProgress(1);
    return { ok: true, data: kept, kept: true };
  }
  const { resp, data } = await fetchModelWithRetry(url, hooks.onProgress, () => hooks.onRetrying(), hooks.onSize);
  if (!resp.ok) return { ok: false, status: resp.status };
  // Kept at once, not after a delay: a phone opened for a few seconds and put
  // away would otherwise never keep it.
  void keepModel(url, data);
  return { ok: true, data, kept: false };
}

export const modelLifecycle: ModelLifecycle = createModelLifecycle({
  readAddonConfig,
  urlFor: centralModelUrl,
  getBytes,
  forgetBrowserModel,
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
});

/** The model's state, for a screen (re-renders on every change). */
export function useModel(): ModelSnapshot {
  return useSyncExternalStore(modelLifecycle.subscribe, modelLifecycle.snapshot);
}
