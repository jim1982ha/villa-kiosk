// src/utils/modelPrefetch.ts
// Background download of the central GLB's BYTES, started as early as
// legally possible — see callers — so BabylonCanvas's real load path can
// reuse them instead of re-fetching from a cold start. Deliberately bytes
// only: a plain fetch() has no cost while it's in flight, so it can safely
// run while the user is still on the interactive profile-select/PIN screen.
//
// v2.29.0 went further and had ProfileGate mount the actual Babylon scene
// early too (so the DECODE — Draco geometry + textures + GPU upload + this
// app's own mesh-indexing pass, 4.5-6.4 SECONDS measured on a real villa —
// would also run before login). That was reverted in v2.30.1: the decode is
// synchronous, main-thread-blocking work, and running it while the gate
// screen was showing froze every click on it for that whole time — exactly
// the opposite of the point. The decode now only ever starts after a real
// session exists (BabylonCanvas mounts post-login), same as before v2.29.0.
// This module still only ever does the safe part (fetching bytes); nothing
// here should be extended to also trigger scene/decode work pre-login again
// without first solving how to make that decode non-blocking (chunking it
// is hard — SceneLoader.ImportMeshAsync is largely opaque third-party code).
//
// /addon-config and /model/ both require a session cookie by default (see
// supervisor-proxy.py's _authorized()) — Ingress-sourced requests are
// auto-trusted, so under Ingress this always starts at the very first frame.
// On the direct/Cloudflare-gated deployment it can only succeed once a
// session exists (an un-PIN'd profile's tap, or a correct PIN) UNLESS the
// add-on's opt-in `public_model_access` option is on (see
// supervisor-proxy.py's _model_authorized() for the security trade-off) —
// with it on, this succeeds at the very first frame there too. An
// unauthorized attempt just fails harmlessly (see fetchAddonConfig's
// no-cache-on-failure behaviour) and the state resets so a later authorized
// call still works.

import { fetchAddonConfig, versionedModelUrl } from "./storage";
import { readWithProgress } from "./fetchProgress";

type ProgressListener = (frac: number) => void;

interface PrefetchEntry {
  url: string;
  promise: Promise<ArrayBuffer>;
  progress: number;
  listeners: Set<ProgressListener>;
}

let state: "idle" | "pending" | "done" = "idle";
let entry: PrefetchEntry | null = null;

/** Fire-and-forget: kick off the background GLB download if nothing is
 *  already in flight or done. Safe to call repeatedly (profile-select mount,
 *  then again right when auth succeeds) — a no-op once something has actually
 *  started, and automatically retryable if the previous attempt found no
 *  authorized model to fetch. Never throws, never awaited by callers. */
export function startModelPrefetch(): void {
  if (state !== "idle") return;
  state = "pending";
  (async () => {
    const addonCfg = await fetchAddonConfig();
    if (!addonCfg.model_path) {
      state = "idle"; // not authorized yet, or no central model — retry later
      return;
    }
    const url = await versionedModelUrl(addonCfg.model_path);
    const e: PrefetchEntry = { url, progress: 0, listeners: new Set(), promise: null as unknown as Promise<ArrayBuffer> };
    e.promise = fetch(url).then((resp) => {
      if (!resp.ok) throw new Error(`prefetch HTTP ${resp.status}`);
      return readWithProgress(resp, (f) => {
        e.progress = f;
        e.listeners.forEach((l) => l(f));
      });
    }).catch((err) => {
      // A transient failure (e.g. dropped connection while still on the PIN
      // screen) shouldn't permanently block a later retry — but only reset
      // if nobody has claimed this entry yet (if claimed, the claimer is
      // already handling the rejection and falling back on its own).
      if (entry === e) { entry = null; state = "idle"; }
      throw err;
    });
    entry = e;
    state = "done";
    // Nobody may ever claim this (e.g. the user never finishes login this
    // visit) — swallow so a failed background prefetch never surfaces as an
    // unhandled rejection. A caller that DOES claim it awaits the same
    // promise and handles the error itself.
    e.promise.catch(() => {});
  })().catch(() => {
    state = "idle";
  });
}

/** If a prefetch for this EXACT model URL is in flight or finished, hand it
 *  over (one-shot — claimed at most once) so the real load path can await it
 *  instead of issuing a fresh fetch. Returns null (do a normal fetch) when
 *  nothing matches, e.g. prefetch hasn't started yet, failed, or the model
 *  was replaced in between. `onProgress` mirrors readWithProgress's
 *  contract — call it immediately with the current fraction, then again on
 *  every update; returns an unsubscribe function. */
export function claimPrefetch(url: string): {
  promise: Promise<ArrayBuffer>;
  onProgress: (fn: ProgressListener) => () => void;
} | null {
  if (!entry || entry.url !== url) return null;
  const e = entry;
  entry = null; // one-shot
  return {
    promise: e.promise,
    onProgress: (fn) => {
      fn(e.progress);
      e.listeners.add(fn);
      return () => e.listeners.delete(fn);
    },
  };
}
