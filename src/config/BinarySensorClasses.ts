// src/config/BinarySensorClasses.ts
//
// binary_sensor entities cover very different things — a water leak sensor,
// a PIR motion sensor, a door/window contact, a smoke detector — and HA
// tells them apart via the entity's `device_class` attribute. The "more
// details" panel used to hard-code leak wording ("LEAK DETECTED" / "No
// leak") for every single binary_sensor regardless of device_class, which
// read as nonsense for a motion or door sensor. This table maps each HA
// device_class to its on/off wording, a representative icon, and whether
// its "on" (or "off", for the few classes where the concerning state is
// off — e.g. connectivity) state is inherently a problem — so the panel's
// danger styling matches what the sensor actually monitors instead of
// assuming every binary_sensor is a leak alarm.
//
// A per-entity config.alertThresholds override always wins over the
// `alarmState` default here (see SensorPanel.tsx) — this table only supplies
// the sensible starting point for a class the user hasn't customised.

import { prettyState } from "@/utils/entityValue";
import { BINARY_WORDS } from "./binarySensorWords";
import {
  Activity, AlertTriangle, BatteryCharging, BatteryWarning, DoorOpen, Droplets,
  Eye, Flame, Home, Lightbulb, Plug, RefreshCw, ShieldAlert, Snowflake,
  Thermometer, Unlock, Vibrate, Volume2, Wifi, Wind, type LucideIcon,
} from "lucide-react";

export interface BinarySensorClassInfo {
  onLabel: string;
  offLabel: string;
  icon: LucideIcon;
  /** Which state (if any) counts as this class's default "problem" state.
   *  "none" = purely informational, never auto-flagged as an alert. */
  alarmState: "on" | "off" | "none";
}

/** Fallback for a missing/unrecognised device_class — preserves the
 *  historical behaviour (generic "on" = alert) for anything not listed. */
const DEFAULT_INFO: BinarySensorClassInfo = {
  onLabel: "On", offLabel: "Off", icon: Activity, alarmState: "on",
};

/** A class's on/off words: config/binarySensorWords, the one table. */
const words = (c: string) => ({ onLabel: BINARY_WORDS[c][0], offLabel: BINARY_WORDS[c][1] });

const BINARY_SENSOR_CLASSES: Record<string, BinarySensorClassInfo> = {
  // Actual hazards — "on" is the problem.
  moisture: { ...words("moisture"), icon: Droplets, alarmState: "on" },
  smoke: { ...words("smoke"), icon: Flame, alarmState: "on" },
  gas: { ...words("gas"), icon: Wind, alarmState: "on" },
  carbon_monoxide: { ...words("carbon_monoxide"), icon: Wind, alarmState: "on" },
  safety: { ...words("safety"), icon: ShieldAlert, alarmState: "on" },
  problem: { ...words("problem"), icon: AlertTriangle, alarmState: "on" },
  tamper: { ...words("tamper"), icon: ShieldAlert, alarmState: "on" },
  heat: { ...words("heat"), icon: Thermometer, alarmState: "on" },
  cold: { ...words("cold"), icon: Snowflake, alarmState: "on" },
  battery: { ...words("battery"), icon: BatteryWarning, alarmState: "on" },
  // Concerning when OFF, not on.
  connectivity: { ...words("connectivity"), icon: Wifi, alarmState: "off" },

  // Informational — presence/state, not a fault, so never auto-alerts.
  motion: { ...words("motion"), icon: Activity, alarmState: "none" },
  moving: { ...words("moving"), icon: Activity, alarmState: "none" },
  occupancy: { ...words("occupancy"), icon: Eye, alarmState: "none" },
  presence: { ...words("presence"), icon: Home, alarmState: "none" },
  sound: { ...words("sound"), icon: Volume2, alarmState: "none" },
  vibration: { ...words("vibration"), icon: Vibrate, alarmState: "none" },
  light: { ...words("light"), icon: Lightbulb, alarmState: "none" },
  door: { ...words("door"), icon: DoorOpen, alarmState: "none" },
  garage_door: { ...words("garage_door"), icon: DoorOpen, alarmState: "none" },
  window: { ...words("window"), icon: DoorOpen, alarmState: "none" },
  opening: { ...words("opening"), icon: DoorOpen, alarmState: "none" },
  lock: { ...words("lock"), icon: Unlock, alarmState: "none" },
  plug: { ...words("plug"), icon: Plug, alarmState: "none" },
  running: { ...words("running"), icon: Activity, alarmState: "none" },
  battery_charging: { ...words("battery_charging"), icon: BatteryCharging, alarmState: "none" },
  update: { ...words("update"), icon: RefreshCw, alarmState: "none" },
};

export function binarySensorClassInfo(deviceClass?: string): BinarySensorClassInfo {
  if (!deviceClass) return DEFAULT_INFO;
  return BINARY_SENSOR_CLASSES[deviceClass] ?? DEFAULT_INFO;
}

/**
 * How a state of this entity is WORDED for a person — the ONE answer the
 * status pill and every history bar give. A moisture sensor's "off" is "No
 * leak", a motion sensor's "on" is "Motion detected", a door's is "Open"; the
 * raw state is shown readable ("Unlocked", "Unavailable") for everything else.
 *
 * ⚠️ The history bar's tooltip used the generic `prettyState`, so hovering a
 * leak sensor's bar said "Off" right under a pill saying "No leak" — the pill
 * had its own inline copy of this rule. Only "on" and "off" take the class
 * wording: an unavailable sensor is "Unavailable", never "No leak".
 */
export function stateLabelFor(entityId: string, deviceClass?: string): (state: string) => string {
  if (!entityId.startsWith("binary_sensor.")) return prettyState;
  const info = binarySensorClassInfo(deviceClass);
  return (state) => state === "on" ? info.onLabel : state === "off" ? info.offLabel : prettyState(state);
}

/**
 * THE rule for "which state of this binary_sensor is a problem", and the only
 * place the per-entity override is combined with the device_class default.
 *
 * ⚠️ IT EXISTED TWICE, AND THE TWO COPIES DISAGREED ON EVERY MOTION SENSOR.
 * `SensorPanel` resolved `threshold?.alertState ?? classInfo.alarmState`, so a
 * PIR reading `on` was "Motion detected" in its calm category colour — which
 * is what this table says, `alarmState: "none"`. The map badge asked a
 * different module, which had no idea `device_class` existed and read a bare
 * `state === "on"` as an alert, so the same sensor rang RED on the villa
 * while the history bar underneath the panel painted the same instant green
 * and the Map-colours legend told the resident red means "needs attention".
 * Three surfaces, three answers, one motion sensor doing its job.
 *
 * `connectivity` was worse than inconsistent, it was inverted: its problem
 * state is `off`, so the badge alerted while the device was CONNECTED and
 * went quiet when it dropped.
 *
 * ⚠️ `override` IS A REQUIRED PARAMETER THAT MAY BE `undefined`. A caller that
 * holds `config.alertThresholds` and forgets to pass it would otherwise be
 * indistinguishable from one that has no override to give — the defect
 * pattern this repo has paid for elsewhere. Saying `undefined` is a
 * statement; omitting the argument was an accident waiting to happen.
 */
export function alertStateFor(
  deviceClass: string | undefined,
  override: string | undefined,
): string | undefined {
  if (override !== undefined) return override;
  const alarm = binarySensorClassInfo(deviceClass).alarmState;
  return alarm === "none" ? undefined : alarm;
}

/** Device classes whose on/off state is a physical opening's POSITION
 *  (open/closed), not a fault or presence reading — the four classes above
 *  that share the door/closed wording and DoorOpen icon. This is what
 *  EntityVisuals gates its binary_sensor pose-swap on (an authored door/
 *  window contact modelled with "__open"/"__closed" alternate meshes, the
 *  same mechanism as cover/lock — see EntityVisuals' VARIANT_VOCAB): only a
 *  sensor whose device_class genuinely means "open vs closed" should ever
 *  have its live state interpreted that way, even though applyMeshVariant
 *  is already a no-op for any entity nobody authored alternate poses for.
 *  A property of the device_class itself, so it lives here rather than
 *  being duplicated in EntityVisuals. */
export const OPENING_DEVICE_CLASSES: ReadonlySet<string> = new Set([
  "door", "garage_door", "window", "opening",
]);

/** binary_sensor device_classes whose "on" means someone or something MOVED.
 *  ⚠️ ONE LIST. Dashboard's motion toast and EntityCategories' access bucket
 *  each carried their own copy, and the toast's comment claimed its id hints
 *  were "the same id hints categoryForEntity uses" — they were not. */
export const MOTION_DEVICE_CLASSES: ReadonlySet<string> = new Set([
  "motion", "presence", "occupancy", "moving",
]);
/** The id words that name a motion detector when HA reports no device_class.
 *  Anchored on "." / "_" / the ends ("_" is a word character, so `\b` would
 *  match "motion" inside "promotion_x"). */
export const MOTION_ID_HINT = /(^|[._])(motion|presence|occupancy|pir)([._]|$)/;
/** The id words that name a door/window/gate contact with no device_class. */
export const OPENING_ID_HINT = /(^|[._])(door|window|gate)([._]|$)/;

/** Is this binary_sensor a motion/presence detector: by its device_class,
 *  or — only when HA reports none — by its id. */
export function isMotionSensor(entityId: string, deviceClass: string | undefined): boolean {
  if (!entityId.startsWith("binary_sensor.")) return false;
  if (deviceClass) return MOTION_DEVICE_CLASSES.has(deviceClass);
  return MOTION_ID_HINT.test(entityId);
}
