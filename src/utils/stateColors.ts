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

/**
 * A lock's discrete 2-way VISUAL bucket — "unlocked"/"locked" — used to pick
 * which of a door lock's alternate meshes to show in the 3D scene (see
 * EntityVisuals' lock handling / VARIANT_VOCAB). Distinct from the mesh-
 * NAMING default: an UNSUFFIXED mesh defaults to "unlocked" (VARIANT_VOCAB.
 * lock), mirroring cover's "no suffix = open/accessible state" convention —
 * that only matters for how a bare mesh is CLASSIFIED when grouped alongside
 * an authored second pose. THIS function instead interprets live HA state,
 * and deliberately leans the OTHER way for anything uncertain (jammed,
 * mid-transition, unavailable) — showing the locked pose rather than a
 * lock's 3D model implying a door is open when its real state genuinely
 * isn't known. Not a contradiction: one is a naming convention, the other a
 * fail-safe default for uncertain live data.
 */
export function lockVisualBucket(entity: HassEntity | undefined): "unlocked" | "locked" {
  if (entity?.state === "unlocked" || entity?.state === "open") return "unlocked";
  return "locked"; // locked / jammed / locking / unlocking / unavailable / unknown / missing
}

/**
 * A door/window CONTACT sensor's 2-way VISUAL bucket — "closed"/"open" —
 * used to pick which of its alternate meshes to show in the 3D scene (see
 * EntityVisuals' binary_sensor handling / VARIANT_VOCAB). Only ever consulted
 * for a device_class HA reports as a physical opening (OPENING_DEVICE_CLASSES
 * in BinarySensorClasses.ts); the standard convention for those is "on" =
 * open, "off" = closed. Mirrors lockVisualBucket's fail-safe lean: anything
 * uncertain (unavailable/unknown) falls back to "closed", the SAME default an
 * unsuffixed mesh gets (VARIANT_VOCAB.binary_sensor) — never implying a real
 * door/window is open when its live state genuinely isn't known.
 */
export function openingVisualBucket(entity: HassEntity | undefined): "closed" | "open" {
  return entity?.state === "on" ? "open" : "closed"; // off / unavailable / unknown / missing -> closed
}

export function coverColor(state: string): string {
  if (state === "open") return ON_COLOR;
  if (state === "closed") return OFF_COLOR;
  return WARN_COLOR; // opening / closing
}

/**
 * A cover's discrete 3-way VISUAL bucket — "closed"/"half"/"open" — used to
 * pick which of a curtain's alternate meshes to show in the 3D scene (see
 * EntityVisuals' cover handling / VARIANT_VOCAB). Deliberately mirrors
 * coverColor's own open/closed/in-between split above, just with position-%
 * awareness added: current_position (0-100, HA convention: 0=closed,
 * 100=open) wins when the device reports it, with a tolerance band since
 * real motors rarely stop at EXACTLY 0/100; devices that only report bare
 * open/closed state (most curtain motors don't report a position at all)
 * fall back to that — opening/closing (actively in transit) reads as "half",
 * the same "something's in between" bucket coverColor already gives it.
 * Anything else genuinely uncertain (unavailable, unknown, a state this
 * function doesn't recognise) falls back to "open" — the SAME default an
 * unsuffixed mesh gets and the index-time safety net applies before any live
 * state is even known (see VARIANT_VOCAB.cover / EntityVisuals' indexMeshes)
 * — so "we don't actually know" reads consistently as "open" everywhere in
 * this feature, never as the half-open bucket (which is reserved for the
 * cases that DO indicate something is genuinely happening: opening/closing).
 */
export function coverVisualBucket(entity: HassEntity | undefined): "closed" | "half" | "open" {
  if (!entity) return "open";
  const pos = entity.attributes.current_position;
  if (typeof pos === "number" && Number.isFinite(pos)) {
    if (pos <= 15) return "closed";
    if (pos >= 85) return "open";
    return "half";
  }
  if (entity.state === "closed") return "closed";
  if (entity.state === "opening" || entity.state === "closing") return "half";
  return "open"; // "open" itself, unavailable, unknown, or anything else
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
