// src/utils/leakWatch.ts
// Regression guard for the in-place reload leak: after a SceneManager is
// disposed, does it actually become garbage?
//
// ── The leak itself is FIXED (2.272.0 + 2.273.0) ───────────────────────────
// A callback prop written inline in Dashboard closed over Dashboard's render
// scope, which held the previous SceneManager, and the canvas captured it in a
// mount effect with `[]` deps. One dead villa retained per reload, ~35MB each,
// chaining backwards. Every callback prop now goes through one ref assigned
// during render (see BabylonCanvas), and dispose() nulls every subsystem.
//
// Verified in the field: the heap floor after five reloads fell from never
// below ~330MB to 171MB.
//
// ── READ `scene`, NOT `mgr` ────────────────────────────────────────────────
// `mgr` still counts up. Each retained manager is an empty shell of 9-68kB
// because dispose() strips it, so a non-zero `mgr` is untidy, not a leak.
//
// `scene` is the alarm. Non-zero means the scene graph — every mesh, geometry
// and texture — is reachable from a disposed manager again, i.e. the fix above
// has been undone. It has read zero since 2.272.0.
//
// ── The two-load grace period ──────────────────────────────────────────────
// A WeakRef that still derefs proves "not collected YET", not "retained" — the
// collector is under no obligation to have run. An entry only counts once a
// FULL further load has happened after the one it was disposed in: a whole
// villa parsed, ~18MB fetched, hundreds of MB allocated. If a major GC has not
// run across that, nothing would ever be collectable and the number is
// unreadable anyway.

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

// ── `?debug` console hooks ─────────────────────────────────────────────────
// The counts also ride on the `load` telemetry record, but that needs three
// model uploads and an export before anything can be read. These give the same
// numbers on demand:
//
//   __villaLeak()      { mgr, scene, loadSeq, watching }. Reads only WeakRefs,
//                      so asking cannot change the answer.
//   __villaLeakHold()  the survivors themselves, for a heap snapshot's
//                      Retainers pane. Takes a STRONG reference, so it ends the
//                      measurement for the session.
//
// If you ever need the Retainers pane again, three traps cost a whole field
// session between them:
//   * call __villaLeakHold() ONCE, at the end — it re-pins on every call, which
//     manufactures a 1→2→3→4→5 climb that looks exactly like the leak;
//   * before snapshotting, clear every `temp*`, delete window.__villaLeakHeld
//     and CLEAR THE CONSOLE — devtools retains everything it has printed, so
//     otherwise every retainer branch you find is your own handle;
//   * the shipped bundle is MINIFIED, so DevTools' constructor filter matches
//     nothing until __villaLeakHold tells you the one-or-two-letter class name.

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
