// src/utils/entityState.ts
// The generic "is this entity on?" / "how many of these are on?" rules,
// shared by anything that needs a coarse cross-domain summary rather than a
// per-domain-precise one (SummaryBar's tiles, the Cockpit page's category
// grid). Extracted from SummaryBar.tsx, which had both first — see there for
// the domain-SPECIFIC summaries (locks, climate averaging, energy) this
// deliberately doesn't attempt; this file is only the generic fallback.

import type { HassEntity } from "@/types/ha.types";
import { TRANSITIONAL_STATES, isUnavailable } from "@/utils/stateColors";

export const OFF_STATES = new Set(["off", "unavailable", "unknown", ""]);

/** Where a row's inline switch should sit. ⚠️ THREE ANSWERS, NOT TWO — see
 *  `switchPosition`. */
export type SwitchPosition = "on" | "off" | "unknown";

/**
 * Which way a two-position switch should be thrown for this entity, or that it
 * must not be thrown at all.
 *
 * ⚠️ THE THIRD ANSWER IS THE WHOLE POINT, AND ITS ABSENCE SHIPPED A LIE ABOUT
 * A DOOR. The device-group row computed `isLock ? e.state !== "locked" : …`,
 * and `!== "locked"` is also true for `unavailable`, `unknown` and `jammed`.
 * A lock Home Assistant had lost contact with therefore rendered its switch in
 * the UNLOCKED position, `aria-checked="true"`, announced as "on" — while the
 * same row's text said "Unavailable" and its badge was amber. `stateColors`'
 * own header forbids exactly this, naming the identical past defect: "silently
 * treating 'unavailable' as 'not locked' rendered a lock HA has lost contact
 * with as a confirmed, alarming UNLOCKED".
 *
 * A boolean has nowhere to put "not known", so the caller was forced to invent
 * a position. Returning three answers removes the choice: there is no switch
 * state for `unknown`, so the control is withheld instead of guessed.
 *
 * A lock in MOTION is `unknown` too, deliberately. It is between two rest
 * states and on its way to one of them; asserting either would be a claim
 * nobody observed, and the map already shows the movement through its pose.
 */
export function switchPosition(e: HassEntity | undefined, domain?: string): SwitchPosition {
  if (isUnavailable(e) || e == null) return "unknown";
  const d = (domain ?? e.entity_id.split(".")[0]).split(".")[0];
  if (d === "lock") {
    if (TRANSITIONAL_STATES.has(e.state)) return "unknown";
    // ⚠️ `jammed` IS NOT `unknown`, AND THE DIFFERENCE IS WHETHER ANYTHING WAS
    // OBSERVED. A jammed lock reported its state: the bolt did not throw, so
    // the door is definitely NOT secured, and falling through to "on" says
    // exactly that. Withholding the switch would also withhold the retry,
    // which is the one thing a person wants at a jammed door. `unavailable`
    // is the opposite case — nothing was observed at all, so there is nothing
    // to put on a switch.
    // Inverted on purpose: the switch reads "unlocked = on", because that is
    // the state a person acts on. `locked` is the quiet, secure rest state.
    return e.state === "locked" ? "off" : "on";
  }
  return OFF_STATES.has(e.state) ? "off" : "on";
}

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
