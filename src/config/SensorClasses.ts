// src/config/SensorClasses.ts
//
// A "sensor" domain entity SHOULD carry a device_class (temperature,
// humidity, power, …) that both the 3D badge glyph (babylon/badgeIconKeys.ts)
// and the device panel's header icon (SensorPanel.tsx) key off. But plenty of
// real-world integrations — template sensors, BLE/MQTT-bridged devices — omit
// device_class and report only a unit_of_measurement. Without a fallback,
// EVERY one of those silently got the generic "gauge" glyph, including a
// plain temperature sensor (°C) — the bug this fixes. Infer device_class from
// unit_of_measurement for the units where that mapping isn't ambiguous; "%" is
// deliberately excluded — humidity vs. battery vs. a generic percentage
// sensor are all equally plausible, so guessing would just swap one wrong
// icon for a different wrong one.
//
// Single source of truth for "which device_class does this sensor effectively
// have" — both consumers derive their own icon representation (a canvas glyph
// key vs. a LucideIcon component) from the SAME resolved class, so the 3D
// badge and the panel that opens from tapping it can never disagree.

import {
  Battery, BatteryCharging, Clock, Droplets, Gauge, Signal, Sun, Thermometer,
  Timer, Wind, Zap, type LucideIcon,
} from "lucide-react";

const UNIT_DEVICE_CLASS_HINT: Record<string, string> = {
  "°c": "temperature", "°f": "temperature",
  "kwh": "energy", "wh": "energy", "mwh": "energy",
  "w": "power", "kw": "power",
  "v": "voltage",
  "a": "current", "ma": "current",
  "lx": "illuminance",
  "hpa": "pressure", "mbar": "pressure", "pa": "pressure", "inhg": "pressure",
  "dbm": "signal_strength",
  "ppm": "carbon_dioxide",
};

/** The device_class to use for icon lookup: the entity's own if present,
 *  otherwise inferred from unit_of_measurement for unambiguous units. */
export function effectiveSensorClass(deviceClass?: string, unit?: string): string | undefined {
  if (deviceClass) return deviceClass;
  if (!unit) return undefined;
  return UNIT_DEVICE_CLASS_HINT[unit.trim().toLowerCase()];
}

/** Scale to the SI base unit for a class this app sums.
 *
 *  ⚠️ SUMMING NEEDS ONE UNIT AND THE SELECTOR DID NOT PROVIDE IT. The Energy
 *  tile selected members with `device_class === "power" || /(^|_)w$|watt/i
 *  .test(unit)` — an entity-id-shaped predicate applied to a UNIT string, which
 *  matches "W" and cannot match "kW" — and then added every member's raw
 *  `state` into a total it labelled watts. Home Assistant's `power` class
 *  permits kW (whole-house meters, P1 readers), so a mains meter reporting
 *  3.2 kW contributed 3.2 to a watt total: the villa's largest draw,
 *  under-reported by 1000×, on the most-glanced tile on the wall. And
 *  `UNIT_DEVICE_CLASS_HINT` above has held `"kw": "power"` the whole time.
 */
export const UNIT_SCALE_TO_BASE: Record<string, number> = {
  // ⚠️ CASE-SENSITIVE, AND THAT IS THE WHOLE POINT. Keyed on
  // `unit.toLowerCase()` this table collapses `mW` (milliwatt) onto `MW`
  // (megawatt). A 500 mW sensor would read as 500000 kW: a 10⁹ error, by the
  // identical mistake that caused the 1000× one — throwing case away on a unit
  // string. SI prefixes ARE case: `m` is milli, `M` is mega, and no amount of
  // normalising can tell them apart afterwards. Home Assistant writes the unit
  // as the integration reports it, so this keys on exactly that.
  W: 1, kW: 1_000, MW: 1_000_000, mW: 0.001,
};

/** The units whose meaning survives lower-casing.
 *
 *  ⚠️ `mw` IS DELIBERATELY ABSENT. Every other power unit is unambiguous once
 *  folded — a villa whose integration writes `"w"` or `"KW"` still sums
 *  correctly — but `mw` could be milli or mega, and guessing is what produces
 *  the 10⁹ error. An ambiguous unit contributes NOTHING: "cannot say" is not
 *  zero, and it is certainly not a number in the wrong unit. */
const CASE_FOLDABLE: Record<string, number> = {
  w: 1, kw: 1_000,
};

/** One reading in WATTS, or `null` when it cannot be said.
 *
 *  ⚠️ POWER ONLY, DELIBERATELY NARROW. A second SI-prefix table
 *  (`entityValue.formatUnitParts`) already owns the DISPLAY side, so widening
 *  this one would be a third answer to the same question. When something needs
 *  to sum energy or current, it can add the row it needs then. */
export function toBaseUnit(state: unknown, unit?: string): number | null {
  const value = Number(state);
  if (!Number.isFinite(value)) return null;
  // ⚠️ EXACT FIRST, THEN ONLY THE UNAMBIGUOUS FOLD. See both tables.
  const raw = String(unit ?? "").trim();
  const exact = UNIT_SCALE_TO_BASE[raw];
  if (exact !== undefined) return value * exact;
  const folded = CASE_FOLDABLE[raw.toLowerCase()];
  return folded === undefined ? null : value * folded;
}

/** device_class -> device panel header icon. Mirrors babylon/badgeIconKeys.ts's
 *  SENSOR_ICON_KEY glyph choices so the 3D badge and its panel always agree. */
export const SENSOR_CLASS_ICON: Record<string, LucideIcon> = {
  temperature: Thermometer,
  humidity: Droplets,
  power: Zap,
  energy: BatteryCharging,
  current: Zap,
  voltage: Zap,
  battery: Battery,
  illuminance: Sun,
  pressure: Gauge,
  gas: Wind,
  carbon_dioxide: Wind,
  volatile_organic_compounds: Wind,
  pm25: Wind,
  signal_strength: Signal,
  timestamp: Clock,
  duration: Timer,
};
