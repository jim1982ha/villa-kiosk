// src/config/BinarySensorClasses.ts
//
// binary_sensor entities cover very different things — a water leak sensor,
// a PIR motion sensor, a door/window contact, a smoke detector — and HA
// tells them apart via the entity's `device_class` attribute. The "more
// details" panel used to hard-code leak wording ("LEAK DETECTED" / "No
// leak") for every single binary_sensor regardless of device_class, which
// read as nonsense for a motion or door sensor. This table maps each HA
// device_class to a representative icon and whether
// its "on" (or "off", for the few classes where the concerning state is
// off — e.g. connectivity) state is inherently a problem — so the panel's
// danger styling matches what the sensor actually monitors instead of
// assuming every binary_sensor is a leak alarm.
//
// A per-entity config.alertThresholds override always wins over the
// `alarmState` default here (see SensorPanel.tsx) — this table only supplies
// the sensible starting point for a class the user hasn't customised.

import { prettyState } from "@/utils/entityValue";
import { binaryWord } from "./binarySensorWords";
import {
  Activity, AlertTriangle, BatteryCharging, BatteryWarning, DoorOpen, Droplets,
  Eye, Flame, Home, Lightbulb, Plug, RefreshCw, ShieldAlert, Snowflake,
  Thermometer, Unlock, Vibrate, Volume2, Wifi, Wind, type LucideIcon,
} from "lucide-react";

/** A class's icon and default problem state. Its WORDS are not here: they
 *  live once in config/binarySensorWords (binaryWord), which every surface reads. */
export interface BinarySensorClassInfo {
  icon: LucideIcon;
  /** Which state (if any) counts as this class's default "problem" state.
   *  "none" = purely informational, never auto-flagged as an alert. */
  alarmState: "on" | "off" | "none";
}

/** Fallback for a missing/unrecognised device_class — preserves the
 *  historical behaviour (generic "on" = alert) for anything not listed. */
const DEFAULT_INFO: BinarySensorClassInfo = {
  icon: Activity, alarmState: "on",
};

const BINARY_SENSOR_CLASSES: Record<string, BinarySensorClassInfo> = {
  // Actual hazards — "on" is the problem.
  moisture: { icon: Droplets, alarmState: "on" },
  smoke: { icon: Flame, alarmState: "on" },
  gas: { icon: Wind, alarmState: "on" },
  carbon_monoxide: { icon: Wind, alarmState: "on" },
  safety: { icon: ShieldAlert, alarmState: "on" },
  problem: { icon: AlertTriangle, alarmState: "on" },
  tamper: { icon: ShieldAlert, alarmState: "on" },
  heat: { icon: Thermometer, alarmState: "on" },
  cold: { icon: Snowflake, alarmState: "on" },
  battery: { icon: BatteryWarning, alarmState: "on" },
  // Concerning when OFF, not on.
  connectivity: { icon: Wifi, alarmState: "off" },

  // Informational — presence/state, not a fault, so never auto-alerts.
  motion: { icon: Activity, alarmState: "none" },
  moving: { icon: Activity, alarmState: "none" },
  occupancy: { icon: Eye, alarmState: "none" },
  presence: { icon: Home, alarmState: "none" },
  sound: { icon: Volume2, alarmState: "none" },
  vibration: { icon: Vibrate, alarmState: "none" },
  light: { icon: Lightbulb, alarmState: "none" },
  door: { icon: DoorOpen, alarmState: "none" },
  garage_door: { icon: DoorOpen, alarmState: "none" },
  window: { icon: DoorOpen, alarmState: "none" },
  opening: { icon: DoorOpen, alarmState: "none" },
  lock: { icon: Unlock, alarmState: "none" },
  plug: { icon: Plug, alarmState: "none" },
  running: { icon: Activity, alarmState: "none" },
  battery_charging: { icon: BatteryCharging, alarmState: "none" },
  update: { icon: RefreshCw, alarmState: "none" },
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
  // the one table of words (binarySensorWords) — this used to read them a second way
  return (state) => binaryWord(entityId, deviceClass, state) ?? prettyState(state);
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

/** The state a binary_sensor is SECURE in, when its kind has one: an opening
 *  (OPENING_DEVICE_CLASSES) closed, a lock locked — both "off". Undefined for
 *  every other kind (stateColors.binaryStatus). */
export function secureStateFor(deviceClass: string | undefined): "off" | undefined {
  return deviceClass !== undefined && (OPENING_DEVICE_CLASSES.has(deviceClass) || deviceClass === "lock") ? "off" : undefined;
}

/** The state in which a DETECTOR reports something, for its window's colours
 *  (stateColors.binaryStatus): a motion or occupancy sensor's "on". Shown red
 *  there, as the camera's motion bar shows a detection, and its quiet "off"
 *  green — the sensor watching. Colours only: it is not a problem state, so the
 *  map and the alerts still treat motion as information (alertStateFor). */
export function detectionStateFor(deviceClass: string | undefined): "on" | undefined {
  return deviceClass === "motion" || deviceClass === "occupancy" ? "on" : undefined;
}

/** The state a sensor's WINDOW colours red: its problem state (alertStateFor),
 *  else, for a detector, its detection (detectionStateFor). */
export function colourAlertStateFor(deviceClass: string | undefined, override: string | undefined): string | undefined {
  return alertStateFor(deviceClass, override) ?? detectionStateFor(deviceClass);
}

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
