// src/utils/modelPrefetch.ts
// Background download of the central GLB, started as early as legally
// possible — see callers — so BabylonCanvas's real load path can reuse the
// bytes instead of re-fetching from a cold start. The single biggest cost in
// the "Villa Loading" spinner is the network transfer of a many-MB GLB; this
// runs that transfer WHILE the user is still looking at the profile-select /
// PIN screen, invisibly (a plain background fetch(), no DOM/scene work, so it
// cannot cause any jank on those screens).
//
// /addon-config and /model/ both require a session cookie on the
// direct/Cloudflare-gated deployment (see supervisor-proxy.py's
// _authorized()) — Ingress-sourced requests are auto-trusted, so under
// Ingress this can genuinely start at the very first frame; under gated mode
// it can only succeed once a session exists (an un-PIN'd profile's tap, or a
// correct PIN), so callers retry it right at that moment too. An early,
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
