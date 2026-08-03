// src/utils/modelPrefetch.ts
// Background download of the central GLB's BYTES, started as early as
// legally possible — see callers — so BabylonCanvas's real load path can
// reuse them instead of re-fetching from a cold start. A plain fetch() has
// no cost while it's in flight, so it always safely runs while the user is
// still on the interactive profile-select/PIN screen.
//
// ONLY the bytes. This file used to also drive an early pre-login SCENE MOUNT
// (v2.29.0, restored in v2.30.2) via an `onPrefetchAvailable` signal that told
// ProfileGate "/model/ is reachable, safe to mount now". That whole strategy
// was abandoned in v2.79.0: choosing a profile takes longer than the idle wait
// the mount was gated behind, so the decode had already started by the time
// the passcode pad opened — and a running synchronous decode cannot be paused,
// which meant dropped digits on the one screen where a mis-tap is
// indistinguishable from a stutter. Pre-login decode is now disabled on every
// platform (ProfileGate's showChildrenEarly = isSwitch), so nothing has
// consumed that signal since.
//
// The signal's machinery (an AvailabilityListener type, a listener Set, a
// subscribe function and the broadcast that fired it) outlived the feature by
// several releases — dead on every load, and its docstring still described a
// consumer that no longer existed, which is the more expensive half of the
// problem: it told the next reader the pre-login mount was still live. Removed
// with the feature it served. Reviving early mount means reviving the decode
// question first (a Web Worker via OffscreenCanvas), at which point the signal
// is trivial to reinstate.
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
  if (!entry) return null;
  const e = entry;
  // One-shot EITHER way: on a URL mismatch (the model was replaced between
  // prefetch and login, so this entry can never match again — versioned
  // URLs only move forward) keeping it would pin the downloaded multi-MB
  // ArrayBuffer for the rest of the session. Drop our reference so it GCs.
  entry = null;
  if (e.url !== url) return null;
  return {
    promise: e.promise,
    onProgress: (fn) => {
      fn(e.progress);
      e.listeners.add(fn);
      return () => e.listeners.delete(fn);
    },
  };
}
