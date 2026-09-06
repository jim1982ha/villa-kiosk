// src/utils/entityValue.ts
//
// HOW VESTA WRITES A READING — the one rule, for both surfaces.
//
// ⚠️ EXTRACTED BECAUSE THE TWO SURFACES DISAGREED. This logic lived at line
// 9268 of EntityVisuals.ts, a 9,858-line Babylon class, so the DOM panels
// could not reach it and each answered the question its own way. The same
// 6570.989 W reading printed "6.6 kW" on the wall tablet and "6570.989 W" in
// the panel beside it; "not_home" was "Not home" on one and ran through a
// different prettifier on the other; and SummaryBar re-derived the ≥1000→kW
// rule inline. CONTEXT.md's opening rule is that the two surfaces must never
// describe the villa differently, and this is where a resident actually reads
// a number.
//
// ⚠️ IMPORTS NOTHING AT RUNTIME except a `.ts`-suffixed sibling, so `node
// test:entity-value` can strip the types and run it with no bundler
// and no GPU. Keep it that way: an `@/`-aliased runtime import silently takes
// the whole module out of the test harness.

import type { HassEntity } from "@/types/ha.types";
import type { EntityType } from "@/types/scene.types";
import { isUnavailable } from "./stateColors.ts";

/** Status/enum SENSOR states meaning "all good, nothing to report".
 *
 *  ⚠️ WHETHER TO HIDE THESE IS THE CALLER'S CHOICE, NOT THIS MODULE'S — see
 *  `hideNominal` on `formatSensorValue`. The badge hides them because it is
 *  already category-coloured and the word is redundant clutter in a chip that
 *  has no room; a panel row has both room and no ring, so it shows them. That
 *  is a difference in the SURFACE, not in how the villa is described, which is
 *  why it is a flag rather than a second implementation.
 *
 *  ALERT states (which drive the badge ring — see utils/deviceActivity's
 *  SENSOR_ALERT_STATES) are the mirror image: their value stays SHOWN, so a
 *  real change is never silently swallowed. An unrecognised enum value (a
 *  weather "sunny") is neither: shown, un-ringed. */
export const SENSOR_NOMINAL_STATES: ReadonlySet<string> = new Set([
  "connected", "online", "ok", "okay", "normal", "nominal", "available",
  "ready", "clear", "operational", "up", "good", "healthy", "active",
]);

/** Round to `d` decimals and drop trailing zeros ("25.0"→"25", "6.60"→"6.6"). */
const trim = (v: number, d: number): string => String(Number(v.toFixed(d)));

/** A formatted reading split into the number and its unit.
 *
 *  ⚠️ SPLIT RATHER THAN JOINED because two panels style the unit differently
 *  from the value (smaller, a separate span). They used to get there by never
 *  formatting at all — printing the raw state and the raw unit — which is how
 *  a 6570.989 W sensor read in full on a panel and "6.6 kW" on the badge.
 *  A unit that HUGS its number (%, °C) comes back inside `value` with an empty
 *  `unit`, so a caller can never split a hugging unit off its sign. */
export interface ValueParts {
  value: string;
  unit: string;
}

/**
 * A number and its unit, written the way this app writes numbers.
 *
 * Large power/energy scales to k-units (6570.989 W → "6.6" + "kW"); percent and
 * degrees hug their sign; the units that read cleanest whole are rounded whole.
 *
 * ⚠️ THE ≥1000 → k RULE IS NOT A TUNING CONSTANT. It is how the unit itself is
 * written (SI prefixes), not a threshold about this property — unlike the
 * hardcoded `totalW > 3000` that used to sit in SummaryBar and was removed for
 * being exactly the per-site constant the first hard rule forbids.
 */
export function formatUnitParts(n: number, unit: string): ValueParts {
  const raw = unit.trim();
  const u = raw.toLowerCase();
  const abs = Math.abs(n);
  if (u === "w" && abs >= 1000) return { value: trim(n / 1000, 1), unit: "kW" };
  if (u === "wh" && abs >= 1000) return { value: trim(n / 1000, 1), unit: "kWh" };
  if (u === "va" && abs >= 1000) return { value: trim(n / 1000, 1), unit: "kVA" };
  if (u === "%") return { value: `${Math.round(n)}%`, unit: "" };
  if (u === "°c" || u === "°f" || u === "°") return { value: `${trim(n, 1)}${raw}`, unit: "" };
  if (u === "w" || u === "wh" || u === "va" || u === "lx" || u === "ppm" || u === "ppb")
    return { value: String(Math.round(n)), unit: raw };
  return { value: Number.isInteger(n) ? String(n) : trim(n, 1), unit: raw };
}

/** `formatUnitParts`, joined. */
export function formatUnitValue(n: number, unit: string): string {
  const p = formatUnitParts(n, unit);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

/** An enum/text state tidied for reading: "not_home" → "Not home". */
export function prettyState(state: string): string {
  const words = String(state).replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Hard cap on pill text so an unexpectedly long value can never blow out the
 *  chip; keeps every pill to a tidy, uniform footprint. */
export function clampPill(text: string): string {
  return text.length > 16 ? `${text.slice(0, 15)}…` : text;
}

/** The metrics `clampToLabelWidth` needs. Structurally satisfied by
 *  `BadgeMetrics` — declared here rather than imported so this module keeps no
 *  runtime edge to the Babylon tier. */
export interface LabelWidthMetrics {
  labelMaxWidthPx: number;
  pillValuePadPx: number;
  pillValueCharPx: number;
  cardPadLeftPx: number;
  cardHeightPx: number;
  cardValuePadPx: number;
  cardValueCharPx: number;
}

/**
 * Truncate value text to what the label container can actually DRAW.
 *
 * Derived, not guessed: the ceiling is `labelMaxWidthPx` and the per-character
 * advance is the one the solver measures the very same string with, so the
 * width reserved and the width drawn agree by construction.
 */
export function clampToLabelWidth(
  text: string, m: LabelWidthMetrics, card: boolean,
): string {
  const fixed = card
    ? m.cardPadLeftPx + m.cardHeightPx + m.cardValuePadPx
    : m.pillValuePadPx;
  const charPx = card ? m.cardValueCharPx : m.pillValueCharPx;
  if (!(charPx > 0)) return text;
  const max = Math.max(1, Math.floor((m.labelMaxWidthPx - fixed) / charPx));
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

export interface SensorValueOptions {
  /** Return "" for a nominal status ("Connected", "OK", …). The badge sets
   *  this; a panel row does not. See SENSOR_NOMINAL_STATES. */
  hideNominal?: boolean;
  /** Cap the result at 16 characters. The badge sets this; a panel row, which
   *  has room, does not. */
  clamp?: boolean;
}

/**
 * Compact, readable value for a sensor — exhaustive across the kinds of state
 * HA reports:
 *   • Numbers → rounded sensibly, large power/energy scaled to k-units
 *     (6570.989 W → "6.6 kW", 25.05 °C → "25.1°C").
 *   • Enum / text states → tidied so a raw "not_home" reads "Not home".
 *   • Unavailable → "" (the caller decides what to show instead).
 */
export function formatSensorParts(
  s: HassEntity, opts: SensorValueOptions = {},
): ValueParts {
  if (isUnavailable(s)) return { value: "", unit: "" };
  const unit = ((s.attributes.unit_of_measurement as string | undefined) ?? "").trim();
  const n = Number(s.state);

  if (s.state.trim() === "" || !Number.isFinite(n)) {
    if (opts.hideNominal && SENSOR_NOMINAL_STATES.has(s.state.trim().toLowerCase()))
      return { value: "", unit: "" };
    const pretty = prettyState(s.state);
    return { value: opts.clamp ? clampPill(pretty) : pretty, unit: "" };
  }

  const parts = formatUnitParts(n, unit);
  if (!opts.clamp) return parts;
  const joined = parts.unit ? `${parts.value} ${parts.unit}` : parts.value;
  return { value: clampPill(joined), unit: "" };
}

export function formatSensorValue(
  s: HassEntity, opts: SensorValueOptions = {},
): string {
  const p = formatSensorParts(s, opts);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

/** The badge's reading: the sensor rule above plus the per-domain attribute
 *  each other type reports its level through. */
export function compactValue(type: EntityType, s: HassEntity): string {
  if (isUnavailable(s)) return "";
  switch (type) {
    case "light": {
      const b = s.attributes.brightness as number | undefined;
      return s.state === "on" && b ? `${Math.round((b / 255) * 100)}%` : "";
    }
    case "fan": {
      const p = s.attributes.percentage as number | undefined;
      return s.state === "on" && p != null ? `${Math.round(p)}%` : "";
    }
    case "cover": {
      const pos = s.attributes.current_position as number | undefined;
      return pos != null ? `${Math.round(pos)}%` : "";
    }
    case "climate": {
      const cur = s.attributes.current_temperature as number | undefined;
      return cur != null ? `${Math.round(cur)}°` : "";
    }
    case "sensor":
      return formatSensorValue(s, { hideNominal: true, clamp: true });
    default:
      return "";
  }
}
