// src/utils/stateColors.ts
// Shared colour helpers for StateTimeline across the device panels — keeps
// on/off/danger colouring consistent with the existing .status-pill tones
// used elsewhere in the same panels.

const ON_COLOR = "var(--status-on)";
const OFF_COLOR = "var(--bg-input)"; // matches .status-pill.off
const WARN_COLOR = "var(--status-warning)";
const DANGER_COLOR = "var(--status-danger)";

/** Plain on/off devices (light, fan, switch): on = accent, off = neutral track. */
export function onOffColor(state: string): string {
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
