// src/utils/modelPrefetch.ts
// Background download of the central GLB's BYTES, started as early as
// legally possible — see callers — so BabylonCanvas's real load path can
// reuse them instead of re-fetching from a cold start. A plain fetch() has
// no cost while it's in flight, so it always safely runs while the user is
// still on the interactive profile-select/PIN screen.
//
// v2.29.0 also had ProfileGate mount the actual Babylon scene early (so the
// DECODE — Draco geometry + textures + GPU upload + this app's own
// mesh-indexing pass, 4.5-6.4 SECONDS measured on a real villa — would run
// before login too). v2.30.1 reverted that: the decode is largely
// synchronous, main-thread-blocking work, and running it while the gate
// screen showed froze every click on it. v2.30.2 restores early scene mount
// as an explicit, informed trade-off (user's call, after being told the
// alternative — genuinely zero-blocking pre-login decode — needs moving the
// whole Babylon layer into a Web Worker via OffscreenCanvas, a large,
// separate rewrite not attempted here): `onPrefetchAvailable` below signals
// ProfileGate once /model/ is confirmed reachable, same as v2.29.0, but
// paired with SceneManager.loadModel now yielding between its major
// top-level steps (see its own comments) to shrink — not eliminate — the
// longest uninterrupted blocking stretch. iOS is still excluded from early
// mount regardless (see ProfileGate) for its own, unrelated reason: a heavy
// villa can exceed iOS's per-tab memory ceiling, and early-mounting there
// would retrigger that crash automatically on every reload before login.
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
type AvailabilityListener = () => void;

interface PrefetchEntry {
  url: string;
  promise: Promise<ArrayBuffer>;
  progress: number;
  listeners: Set<ProgressListener>;
}

let state: "idle" | "pending" | "done" = "idle";
let entry: PrefetchEntry | null = null;
const availabilityListeners = new Set<AvailabilityListener>();

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
    // We KNOW at this point that /model/ + /addon-config are reachable right
    // now (the fetch() call above was accepted — its eventual success/failure
    // doesn't change that) — safe for ProfileGate to mount the real scene
    // early, since BabylonCanvas's own load effect will find a model waiting
    // for it instead of hitting the same 401 this call would have hit before
    // now. Fire even if e.promise later fails; BabylonCanvas's normal error
    // handling (behind the opaque auth-screen overlay either way) covers that.
    availabilityListeners.forEach((l) => l());
  })().catch(() => {
    state = "idle";
  });
}

/** Notify `fn` once /model/ becomes confirmed-reachable (immediately, if a
 *  prefetch already succeeded before this was called). Used by ProfileGate to
 *  decide it's safe to mount the real scene before login — see its docstring.
 *  Returns an unsubscribe function. */
export function onPrefetchAvailable(fn: AvailabilityListener): () => void {
  if (entry) fn();
  availabilityListeners.add(fn);
  return () => availabilityListeners.delete(fn);
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
