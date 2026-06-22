// src/config/ThresholdConfig.ts
// Alert thresholds per entity. Used by the AlertBadge and SensorPanel to decide
// normal / warning / danger. Editable in Settings and persisted to localStorage.

export interface Threshold {
  min?: number; // below -> alert
  max?: number; // above -> alert
  /** For binary_sensor: which state counts as an alert (default "on"). */
  alertState?: string;
}

export const DEFAULT_THRESHOLDS: Record<string, Threshold> = {
  "sensor.sensor_t1_temperature": { min: 16, max: 32 },
  "binary_sensor.water_leak_water_heater_1f_water_leak": { alertState: "on" },
};

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
