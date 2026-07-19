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
