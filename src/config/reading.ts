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
//
// ⚠️ AND THE LISTS ASK HERE TOO (architecture review 2026-10-16, step 1). The
// device lists, the Cockpit's alarm line and Recent activity each reached past
// this module into entityValue and BinarySensorClasses for their words, so a
// change of wording made here reached the windows alone. They ask rowText,
// alarmText and stateWords now — the same words they printed before
// (tests/oracles/reading_surfaces.mjs compares them with the old helpers).
//
// ⚠️ AND THE PANEL PILLS AND THE HISTORY BAR (step 2). The lock and cover
// windows took their pill's words and tone from stateColors and panelRules,
// the history bar its default words and its offline colour from entityValue
// and stateColors. They ask lockPill, coverPill, readableState and
// chartColours now — same words, same tones (same oracle).

import type { HassEntity } from "@/types/ha.types";
import type { AlertLevel, Threshold } from "./ThresholdConfig";
import { readingKind, readingLevel, type ReadingKind } from "./sensorReading";
import { binaryLook } from "./binaryLook";
import { stateLabelFor } from "./BinarySensorClasses";
import { deviceRowText, formatSensorParts, prettyState } from "@/utils/entityValue";
import { domainOf } from "@/utils/entityDomain";
import { isUnavailable, paintState, statusKeyFor, STATUS_PILL_CLASS } from "@/utils/stateColors";
import { coverStateLabel } from "@/utils/panelRules";

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

/** Which history goes under a reading: the states of an on/off sensor, the
 *  words of a words sensor (with a legend, its states being open-ended), or
 *  the numbers of a measurement — offline included, whose chart shades the
 *  outage. A numeric parse of a words sensor would drop every row.
 *
 *  ⚠️ ONE RULE FOR EVERY WINDOW (architecture review 11, 2026-10-09). The
 *  sensor window and the grouped device window each chose for themselves, and
 *  drifted: a words sensor in a group showed no history at all. */
export type ReadingHistory = "states" | "words" | "numbers";
export function historyOf(r: Reading): ReadingHistory {
  return r.kind === "binary" ? "states" : r.kind === "text" ? "words" : "numbers";
}

/** What a ROW prints beside a device — the device lists and "Also on this
 *  device": the number scaled as the badge writes it, a climate's current →
 *  target, a binary sensor in its class's words, "Unavailable" when offline.
 *  Not shouted: a row is not a pill. */
export function rowText(id: string, entity: HassEntity): string {
  return deviceRowText(entity, domainOf(id));
}

/** How a state of this entity is worded — for a state that is not its current
 *  one (Recent activity, a history bar's tooltip): a binary sensor's "on" and
 *  "off" in its class's words, every other state readable ("Not home"). */
export function stateWords(id: string, deviceClass: string | undefined): (state: string) => string {
  return stateLabelFor(id, deviceClass);
}

/** The Cockpit's alarm line: a binary sensor's own words for its state
 *  ("Leak detected", "Disconnected"); anything else, what its row says
 *  ("Unlocked", "Jammed", "92%"). */
export function alarmText(id: string, entity: HassEntity): string {
  return domainOf(id) === "binary_sensor"
    ? stateWords(id, entity.attributes.device_class as string | undefined)(entity.state)
    : rowText(id, entity);
}

/** A control window's state pill: its words and its `.status-pill` tone. */
export interface StatePill {
  text: string;
  /** The `.status-pill` modifier class ("on", "danger", "transitional"…). */
  tone: string;
}

/** The tone of a state's pill — the same reading of the state that colours
 *  its history bar (stateColors.statusKeyFor, by the entity's domain). */
const pillTone = (id: string, state: string | undefined): string =>
  STATUS_PILL_CLASS[statusKeyFor(state ?? "", id)];

/** The lock window's pill: the state the lock actually reported, shouted
 *  ("UNLOCKING", "JAMMED"), "UNKNOWN" when there is no lock entity at all. */
export function lockPill(id: string, state: string | undefined): StatePill {
  return { text: (state ?? "unknown").replace(/_/g, " ").toUpperCase(), tone: pillTone(id, state) };
}

/** The cover window's pill: "Open", "Partially open (40%)", "Closed" —
 *  `position` is the slider's (it follows a drag), undefined when the cover
 *  reports none; any other state as HA sent it. */
export function coverPill(id: string, state: string | undefined, position: number | undefined): StatePill {
  return { text: coverStateLabel(state, position), tone: pillTone(id, state) };
}

/** A state's words when nothing says how this entity words it — a history
 *  bar's tooltip by default ("not_home" → "Not home"). */
export function readableState(state: string): string {
  return prettyState(state);
}

/** A history bar's colours: the window's own, except that an unavailable or
 *  unknown stretch is ALWAYS the legend's offline colour. */
export function chartColours(colorFor: (state: string) => string): (state: string) => string {
  return paintState(colorFor);
}
