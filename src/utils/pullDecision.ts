// src/utils/pullDecision.ts
// What a shared store does with a copy it just fetched from the add-on.
//
// ⚠️ ONE RULE, WRITTEN TWICE WITH DIFFERENT FLAGS: a pull must never overwrite
// work this device has not got onto the server yet. The device-config sync
// asked it AFTER its fetch, against the baseline — deliberately, because the
// edit at risk is one that lands while the request is in flight ("I set the
// room, and seconds later it reverts"). The Facility store asked it only
// BEFORE its fetch (`inFlight`, `unsaved`), so a completion logged during a
// refresh, whose save finished first, was then overwritten by the stale copy:
// gone from this device's screen until a later refresh, though safe on the
// server. Both now ask this, after the fetch, with what they know.
//
// The order is the rule:
//   wait         a write of ours is still in flight — its answer is newer
//   unreachable  nothing came back — keep what we have
//   seed         the store is empty — record an EMPTY baseline (the truth),
//                so the normal push is what writes the seed
//   repush       we hold work the server has not got — send it, rather than
//                refusing every pull for an edit nothing will ever retry
//   noop         the server has nothing new — touching config would still
//                hand React fresh objects, and a structural re-index
//   apply        take the server's copy
// Pure; tests/oracles/pull_decision.mjs.

export type PullAction = "wait" | "unreachable" | "seed" | "repush" | "noop" | "apply";

export interface PullFacts {
  /** A write from this device is still waiting for its answer. */
  writeInFlight: boolean;
  /** The fetch returned a copy. */
  reached: boolean;
  /** …and that copy is an empty store. */
  serverEmpty: boolean;
  /** This device holds work the server has not got (an unsaved or failed
   *  write, an edit still in its debounce, or a write made DURING the fetch). */
  localAhead: boolean;
  /** Applying the fetched copy would change what this device shows. */
  wouldChange: boolean;
}

export function decidePull(f: PullFacts): PullAction {
  if (f.writeInFlight) return "wait";
  if (!f.reached) return "unreachable";
  if (f.serverEmpty) return "seed";
  if (f.localAhead) return "repush";
  return f.wouldChange ? "apply" : "noop";
}
