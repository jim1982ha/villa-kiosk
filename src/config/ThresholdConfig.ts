// src/config/ThresholdConfig.ts
// Alert thresholds per entity. Used by SensorPanel to decide normal / warning /
// danger for a sensor's reading (no in-app editor yet — config.alertThresholds
// is fully stored-config-driven; this file only supplies the seed).

export interface Threshold {
  min?: number; // below -> alert
  max?: number; // above -> alert
  /** For binary_sensor: which state counts as an alert (default "on"). */
  alertState?: string;
}

/**
 * Seed alert thresholds — intentionally EMPTY.
 *
 * This used to hardcode two literal entity_ids (a specific temperature sensor
 * and a specific water-leak sensor) belonging to the one villa this app was
 * first built against. A fresh install on any other villa got thresholds for
 * devices it doesn't have, and none for the ones it does. No numeric
 * min/max range has a universal default anyway (any value is right for one
 * villa and wrong for the next), so there is nothing safe to seed here.
 *
 * A binary_sensor still gets sensible alert behaviour with this empty —
 * SensorPanel falls back to HA's own `device_class` (a leak/moisture sensor
 * auto-flags on "on" with no threshold needed at all; see
 * BinarySensorClasses.ts). Only a NUMERIC range (a temperature/humidity
 * band, say) genuinely needs a per-villa value, and that has to come from
 * `config.alertThresholds` — real per-install data — not a shipped default.
 */
export const DEFAULT_THRESHOLDS: Record<string, Threshold> = {};

export type AlertLevel = "normal" | "warning" | "danger";

/** Evaluate a numeric reading against a threshold. */
export function levelForValue(value: number, t?: Threshold): AlertLevel {
  if (!t) return "normal";
  if (t.max !== undefined && value > t.max) return "danger";
  if (t.min !== undefined && value < t.min) return "danger";
  // Warn within 10% of a configured bound.
  if (t.max !== undefined && value > t.max - Math.abs(t.max) * 0.1) return "warning";
  if (t.min !== undefined && value < t.min + Math.abs(t.min) * 0.1) return "warning";
  return "normal";
}
