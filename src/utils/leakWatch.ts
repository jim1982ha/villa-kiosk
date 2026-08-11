// src/utils/leakWatch.ts
// Answers ONE question about the in-place reload, and deliberately not more:
// after a SceneManager is disposed, does it actually become garbage?
//
// ── The measurement this exists because of (2.231.0) ────────────────────────
// A field dump caught a session that remounted BabylonCanvas six times (each
// model upload bumps Dashboard's `modelKey`, which is a full unmount/remount)
// and watched `mem` climb without ever coming back down:
//
//   376 → 462 → 551 → 588 → 615 → 675 → 795 → 848 → 872 → 941 → 948 MB
//
// Individual samples swing either way — one read 1,115MB and the next 795MB —
// because that is GC's sawtooth, and the sawtooth is itself the proof that
// collection IS running. What never recovers is the FLOOR: roughly 95MB per
// reload, retained for the life of the document. Six uploads reach ~950MB on
// a desktop; the same six on the iPad this ships to would be killed by the OS
// long before that, and `autoReload.ts`'s heap valve cannot intervene because
// Safari does not expose `performance.memory` at all — every Safari and iOS
// record in that dump has no `mem` field to read.
//
// ── Why a WeakRef and not a heap snapshot ──────────────────────────────────
// The retainer cannot be found by reading: the disposal path already removes
// every window/document listener, disconnects both observers, disposes each
// subsystem explicitly, nulls the manager out of React state and its ref,
// revokes the model's blob URL in a `finally`, and force-loses the WebGL
// context. All of that is correct, and the leak survives it. The next step is
// a heap snapshot naming the retaining path — which needs a machine with
// devtools attached to the kiosk, at the moment it happens.
//
// This is the cheap thing that decides WHICH heap to go and snapshot, from the
// field, with no tooling:
//
// - `staleMgrs > 0` — the SceneManager object graph itself is still reachable.
//   Something outside it holds a reference, and every mesh, geometry and
//   texture hangs off that. Look for the reference.
// - `staleMgrs === 0` but `staleScenes > 0` — the manager went, and Babylon's
//   own `Scene` outlived it. That is an engine-side registry, not our code.
// - Both zero, `mem` still climbing — nothing about the scene is retained and
//   the growth is elsewhere entirely (a module-level cache, detached DOM,
//   GPU-side allocations that never appear in `usedJSHeapSize` anyway).
//
// Each is a different investigation, and guessing between them is how six
// wrong causes got proposed for the light-artifact bug before a measurement
// settled it.
//
// ── The one-load grace period ──────────────────────────────────────────────
// A WeakRef that still derefs proves "not collected YET", which is not the
// same as "retained" — the collector is under no obligation to have run. So
// an entry only counts once a FULL further load has happened after the one it
// was disposed in: a whole villa parsed, ~18MB fetched, hundreds of MB
// allocated. If a major GC has not run across that, nothing would ever be
// collectable and the number is unreadable anyway.

import { debugFlagEnabled } from "@/utils/devLog";

/** A disposed object, and the load sequence it was disposed during. */
interface Watched {
  ref: WeakRef<object>;
  seq: number;
  kind: string;
}

let watched: Watched[] = [];

/** WeakRef/FinalizationRegistry are ES2021 — Safari 14.1+, Chrome 84+, so
 *  present on every browser this app supports. Guarded anyway because the
 *  cost of being wrong is a crash on the load path, and the cost of the guard
 *  is one `typeof`. */
const supported = typeof WeakRef === "function";

/**
 * Start watching an object that has just been disposed and SHOULD now be
 * unreachable. `seq` is the load sequence it belonged to (bootTimeline's
 * loadSeq), which is what the grace period below is counted in.
 */
export function watchDisposed(kind: string, obj: object | null, seq: number): void {
  if (!supported || !obj) return;
  // Bounded: a kiosk that somehow reloads hundreds of times must not turn its
  // own leak detector into a second leak. WeakRefs are tiny and hold nothing
  // alive, but the array itself would still grow forever.
  if (watched.length >= 32) watched.shift();
  watched.push({ kind, seq, ref: new WeakRef(obj) });
}

/**
 * How many watched objects from a load at least two sequences ago are STILL
 * reachable, broken down by kind. Also drops the entries that have since been
 * collected, so the array stays short and a repeated read cannot double-count
 * something that went away in between.
 */
export function staleDisposed(currentSeq: number): Record<string, number> {
  if (!supported) return {};
  const out: Record<string, number> = {};
  watched = watched.filter((w) => {
    if (w.ref.deref() === undefined) return false; // collected — stop tracking
    // Disposed during the load that just ended, or the one before it: too
    // early to say anything. Keep watching, don't count.
    if (w.seq > currentSeq - 2) return true;
    out[w.kind] = (out[w.kind] ?? 0) + 1;
    return true;
  });
  return out;
}

/** Test seam / remount hygiene — a fresh document starts with nothing. */
export function resetLeakWatch(): void {
  watched = [];
}

// ── Reading the answer from the device, with `?debug` ──────────────────────
// The counts ride on the `load` telemetry record, which needs three model
// uploads and an export before anything can be read. That is a long loop for a
// yes/no question, and the alternative — a heap snapshot — does not work on
// what the kiosk actually serves: the production bundle is MINIFIED, so
// `SceneManager` is a one-letter name and DevTools' constructor filter matches
// nothing at all. (Field-tested: it matches nothing at all.)
//
// So the same numbers, on demand, from the console:
//
//   __villaLeak()      { mgr, scene } — objects disposed two or more loads ago
//                      that are STILL reachable, plus how many are still
//                      inside the grace period. Reads only WeakRefs, so asking
//                      cannot change the answer.
//   __villaLeakHold()  the surviving objects themselves, for a heap snapshot's
//                      Retainers pane. This takes a STRONG reference and ends
//                      the measurement for the rest of the session — which is
//                      fine, because by then the question is no longer "is
//                      something retained" but "by what".
//
// Guarded by `?debug` so nothing is attached to `window` in normal use.

interface LeakWindow extends Window {
  __villaLeak?: () => Record<string, number>;
  __villaLeakHold?: () => object[];
  /** Where __villaLeakHold parks what it found, so DevTools can reach it. */
  __villaLeakHeld?: object[];
}

export function installLeakConsole(currentSeq: () => number): void {
  if (!supported || !debugFlagEnabled()) return;
  const w = window as LeakWindow;
  w.__villaLeak = () => {
    const seq = currentSeq();
    // The grace period is the whole reason a naive read misleads: an object
    // that has not been collected YET is not a retained object, and nothing
    // can be concluded until a full further load has allocated hundreds of MB.
    return { ...staleDisposed(seq), loadSeq: seq, watching: watched.length };
  };
  w.__villaLeakHold = () => {
    const held = watched
      .map((x) => x.ref.deref())
      .filter((o): o is object => o !== undefined);
    w.__villaLeakHeld = held;
    return held;
  };
}
