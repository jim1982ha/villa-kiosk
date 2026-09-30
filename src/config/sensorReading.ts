// src/config/sensorReading.ts
// What kind of reading a sensor gives — on/off, a measurement, or text — and
// how alarming it is. ONE answer for the sensor panel and the grouped-device
// panel (2.496.229).
//
// ⚠️ THE TWO PANELS DISAGREED ABOUT AN OFFLINE SENSOR. The grouped panel held
// that "a reading with a unit is a measurement even while it is UNAVAILABLE"
// (its chart's shaded outage is exactly what it has to say then); the sensor
// panel decided by parsing the current state as a number, so an offline power
// or temperature sensor ("unavailable" is not a number) became a TEXT sensor
// and swapped its chart for the text timeline.

import type { HassEntity } from "@/types/ha.types";
import { levelForValue, type AlertLevel, type Threshold } from "./ThresholdConfig";
import { isUnavailable } from "@/utils/stateColors";

export type ReadingKind = "binary" | "measurement" | "text";

/**
 * - binary: a binary_sensor (on/off, worded by its device class);
 * - measurement: its state is a number — or it is offline and has a unit;
 * - text: a state that is words (an access point's "connected", a weather
 *   condition), shown as a timeline of states rather than a line chart.
 * An entity Home Assistant has not loaded is treated as a measurement (the
 * numeric history shows its own "no data" state).
 */
export function readingKind(entity: HassEntity | undefined, mappingType: string): ReadingKind {
  if (mappingType === "binary_sensor") return "binary";
  if (entity == null) return "measurement";
  if (Number.isFinite(Number(entity.state))) return "measurement";
  const unit = entity.attributes?.unit_of_measurement;
  return isUnavailable(entity) && typeof unit === "string" && unit !== "" ? "measurement" : "text";
}

/** How alarming the reading is: a binary sensor in its alert state is
 *  danger; a measurement outside its thresholds is; text never is. */
export function readingLevel(
  entity: HassEntity | undefined, kind: ReadingKind, threshold: Threshold | undefined, alertState: string | undefined,
): AlertLevel {
  if (kind === "binary") return alertState !== undefined && entity?.state === alertState ? "danger" : "normal";
  const n = Number(entity?.state);
  return kind === "measurement" && Number.isFinite(n) ? levelForValue(n, threshold) : "normal";
}
