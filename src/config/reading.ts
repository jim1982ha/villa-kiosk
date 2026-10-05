// src/config/reading.ts
// WHAT A SENSOR'S READING IS, IN EVERY WINDOW — one answer (2.496.305). Pure:
// tests/oracles/reading.mjs drives it by value.
//
// The sensor window, the grouped device window and "Also on this device" each
// used to assemble a reading from the same pieces — readingKind, readingLevel,
// binaryLook, the formatter, isUnavailable — and each assembled it differently:
//   · the grouped window never asked for the owner's thresholds (readingLevel
//     was called only by the sensor window), so a temperature over its limit
//     was red alone and plain in its group;
//   · a grouped detector in alarm lost the capitals and the warning icon;
//   · the rows coloured binary sensors only.
// Six releases in one day (2.496.279–297) each re-fixed one of those windows.
// Now every window asks here and only lays the answer out.

import type { HassEntity } from "@/types/ha.types";
import type { AlertLevel, Threshold } from "./ThresholdConfig";
import { readingKind, readingLevel, type ReadingKind } from "./sensorReading";
import { binaryLook } from "./binaryLook";
import { formatSensorParts } from "@/utils/entityValue";
import { isUnavailable } from "@/utils/stateColors";

/** The colour a measurement's number (and its chart) takes at each level. */
const LEVEL_COLOR: Record<AlertLevel, string> = {
  normal: "var(--status-on)",
  warning: "var(--status-warning)",
  danger: "var(--status-danger)",
};

export interface Reading {
  kind: ReadingKind;
  unavailable: boolean;
  /** How alarming: a binary sensor in its problem state, or a measurement
   *  outside the owner's thresholds. */
  level: AlertLevel;
  /** What to print: the number, the words — in CAPITALS when it is an alarm
   *  or offline, as a pill shouts them. */
  value: string;
  /** The number's unit, already scaled with it ("kW"); "" otherwise. */
  unit: string;
  /** Drawn as a `.status-pill` of this tone (binary, or offline), or null for
   *  a number or words printed in `color`. */
  pill: string | null;
  /** An alarm: the warning icon goes with it. */
  alarm: boolean;
  /** The colour of the printed number or words (and a measurement's chart). */
  color: string;
  /** A measurement's chart line: its level's colour (offline included —
   *  the chart's shaded outage says that). */
  seriesColor: string;
  /** Each state's colour in its history bar — binary sensors only. */
  stateColor: ((state: string) => string) | null;
}

/**
 * The reading of `id`. `mappingType` is how the villa maps it ("binary_sensor"
 * for an on/off sensor); `alertThresholds` the owner's limits and alert states.
 *
 * Offline always wins: an unavailable sensor never shows its class's "Clear"
 * or "No leak", which would claim a reading that was never taken.
 */
export function readingOf(
  id: string,
  entity: HassEntity | undefined,
  mappingType: string,
  alertThresholds: Readonly<Record<string, Threshold>>,
): Reading {
  const kind = readingKind(entity, mappingType);
  const threshold = alertThresholds[id];
  const unavailable = isUnavailable(entity);
  const deviceClass = entity?.attributes.device_class as string | undefined;
  if (kind === "binary") {
    const look = binaryLook(id, deviceClass, threshold?.alertState);
    const level = readingLevel(entity, kind, threshold, look.problem);
    const state = entity?.state === "on" ? "on" : "off";
    const alarm = !unavailable && level === "danger";
    const words = look.word(state);
    return {
      kind, unavailable, level,
      value: unavailable ? "UNAVAILABLE" : alarm ? words.toUpperCase() : words,
      unit: "",
      pill: unavailable ? "unavailable" : alarm ? "danger" : look.tone(state),
      alarm: unavailable || alarm,
      color: unavailable ? "var(--status-warning)" : "var(--text-primary)",
      seriesColor: LEVEL_COLOR[level],
      stateColor: look.color,
    };
  }
  const level = readingLevel(entity, kind, threshold, undefined);
  const parts = entity ? formatSensorParts(entity) : { value: "", unit: "" };
  return {
    kind, unavailable, level,
    value: unavailable ? "UNAVAILABLE" : parts.value || (entity?.state ?? "—"),
    unit: unavailable ? "" : parts.unit,
    pill: unavailable ? "unavailable" : null,
    alarm: unavailable || level === "danger",
    color: unavailable ? "var(--status-warning)" : kind === "text" ? "var(--text-primary)" : LEVEL_COLOR[level],
    seriesColor: LEVEL_COLOR[level],
    stateColor: null,
  };
}

/** The `.status-pill`-style tone for a reading shown as a ROW's value ("Also
 *  on this device"): its pill tone, or a measurement's level when it is out of
 *  bounds; a normal number keeps the row's quiet colour (undefined). */
export function rowTone(r: Reading): string | undefined {
  if (r.pill) return r.pill;
  return r.level === "normal" ? undefined : r.level;
}
