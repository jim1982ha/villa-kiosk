// src/utils/entityState.ts
// The generic "is this entity on?" / "how many of these are on?" rules,
// shared by anything that needs a coarse cross-domain summary rather than a
// per-domain-precise one (SummaryBar's tiles, the Cockpit page's category
// grid). Extracted from SummaryBar.tsx, which had both first — see there for
// the domain-SPECIFIC summaries (locks, climate averaging, energy) this
// deliberately doesn't attempt; this file is only the generic fallback.

import type { HassEntity } from "@/types/ha.types";
import { UNKNOWN_STATES } from "./stateColors";

/** ⚠️ DERIVED, NOT RESTATED. "Off-like" is "not known" plus the two ways an
 *  entity says it is doing nothing; writing the four out again is how
 *  `readiness.ts` came to carry an identical `OFF_LIKE` under a second name. */
export const OFF_STATES: ReadonlySet<string> =
  new Set(["off", "", ...UNKNOWN_STATES]);

/** Generic cross-domain "is this on" — anything not off/unavailable/unknown
 *  counts, so it covers an open cover, an unlocked lock, a playing media
 *  player or a heating climate uniformly without an exhaustive per-domain
 *  allow-list. Domain-specific tiles (locks, climate) still compute their
 *  OWN active set where "on" isn't the right word for what's being counted. */
export function isOn(e: HassEntity | undefined): boolean {
  return !!e && !OFF_STATES.has(e.state);
}

/** The ONE phrasing every "how many of these are on?" summary uses:
 *    all on   -> "All On"      none on -> "All Off"
 *    some on  -> "3 On"        single  -> plain "On" / "Off"
 *
 *  Written once because these are read side by side and any drift between
 *  them looks like a bug: AC saying a bare "Off" while Lights right next to
 *  it says "All Off" for the identical situation. A single device says just
 *  "On"/"Off" — "All Off" for one AC unit would be odd. */
export function onOffSummary(onCount: number, total: number): string {
  if (total === 0) return "None";
  if (onCount === 0) return total === 1 ? "Off" : "All Off";
  if (onCount === total) return total === 1 ? "On" : "All On";
  return `${onCount} On`;
}
