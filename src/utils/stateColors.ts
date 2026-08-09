// src/utils/stateColors.ts
// Shared colour helpers for StateTimeline across the device panels — keeps
// on/off/danger colouring consistent with the existing .status-pill tones
// used elsewhere in the same panels.

import type { HassEntity } from "@/types/ha.types";

/** HA reports "unavailable" when it has lost contact with the device
 *  (offline, integration reload, …) and "unknown" when it's never reported a
 *  real value yet — in BOTH cases the entity's true state is NOT known, so a
 *  panel must never fold either into a definite on/off/locked/open reading.
 *  Every panel's binary state derivation (`entity?.state === "on"`, etc.)
 *  needs to check this FIRST — see LockPanel, the worst case: silently
 *  treating "unavailable" as "not locked" rendered a lock HA has lost contact
 *  with as a confirmed, alarming "UNLOCKED". */
export function isUnavailable(entity: HassEntity | undefined): boolean {
  return entity == null || entity.state === "unavailable" || entity.state === "unknown";
}

/**
 * THE status vocabulary — four meanings, one colour each, defined here and
 * nowhere else.
 *
 * This is what the "Map colours" legend documents to the user, so anything
 * that paints a status has to read it from here or the legend becomes a lie.
 * The camera status bar was the case that proved it: it had its own literal
 * `#000` for a camera being offline, while the legend told the user that
 * losing contact with a device is amber. Two answers to the same question,
 * neither aware of the other.
 */
export const STATUS_COLOR = {
  /** On / active. */
  active: "var(--status-on)",
  /** Off / idle / nothing to report. Deliberately the same token the
   *  timeline track and .status-pill.off already use, so "nothing happened"
   *  and "not painted" are literally the same colour and cannot drift. */
  idle: "var(--bg-input)",
  /** Home Assistant has lost contact — state genuinely unknown. */
  unavailable: "var(--status-warning)",
  /** Needs attention. */
  alert: "var(--status-danger)",
} as const;

const ON_COLOR = STATUS_COLOR.active;
const OFF_COLOR = STATUS_COLOR.idle; // matches .status-pill.off
const WARN_COLOR = STATUS_COLOR.unavailable;
const DANGER_COLOR = STATUS_COLOR.alert;

/** Plain on/off devices (light, fan, switch): on = accent, off = neutral track. */
export function onOffColor(state: string): string {
  // "unavailable"/"unknown" is NOT "off" — painting a stretch where Home
  // Assistant had lost contact in the same grey as a device that was
  // deliberately switched off asserts a state nobody observed, and it is the
  // one distinction this palette exists to keep (see UNAVAILABLE's own note
  // and babylon/colors.ts). Amber on the timeline, exactly as the status pill
  // and the map badge already report it.
  if (state === "unavailable" || state === "unknown") return WARN_COLOR;
  return state === "on" ? ON_COLOR : OFF_COLOR;
}

/** binary_sensor: like onOffColor, but the device_class's "problem" state (if
 *  configured — see ThresholdConfig/BinarySensorClasses) reads as danger. */
export function binarySensorColor(state: string, alertState?: string): string {
  if (alertState !== undefined && state === alertState) return DANGER_COLOR;
  return state === "on" ? ON_COLOR : OFF_COLOR;
}

export function lockColor(state: string): string {
  if (state === "locked") return ON_COLOR;
  if (state === "unlocked") return DANGER_COLOR;
  return WARN_COLOR; // jammed / opening / unknown
}

export function coverColor(state: string): string {
  if (state === "open") return ON_COLOR;
  if (state === "closed") return OFF_COLOR;
  return WARN_COLOR; // opening / closing
}

const PALETTE = [ON_COLOR, "var(--accent)", WARN_COLOR, DANGER_COLOR, "var(--accent-strong)"];

/**
 * Stable colour-per-distinct-state for an arbitrary text/enum sensor whose
 * possible values aren't known ahead of time (e.g. an access point's
 * "connected"/"disconnected", a weather condition string, …) — first-seen
 * order, cycling the palette if there are more distinct states than colours.
 */
export function paletteColorFor(states: string[]): (state: string) => string {
  const map = new Map<string, string>();
  let i = 0;
  for (const s of states) {
    if (!map.has(s)) map.set(s, PALETTE[i++ % PALETTE.length]);
  }
  return (state: string) => map.get(state) ?? "var(--text-dim)";
}
