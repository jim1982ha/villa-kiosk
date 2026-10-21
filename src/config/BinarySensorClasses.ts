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

import { prettyState } from "@/utils/entityValue";
import { binaryWord } from "./binarySensorWords";
import {
  Activity, AlertTriangle, BatteryCharging, BatteryWarning, DoorOpen, Droplets,
  Eye, Flame, Home, Lightbulb, Plug, RefreshCw, ShieldAlert, Snowflake,
  Thermometer, Unlock, Vibrate, Volume2, Wifi, Wind, type LucideIcon,
} from "lucide-react";
import { isDomain } from "@/utils/entityDomain";

/** A class's icon and default problem state. Its WORDS are not here: they
 *  live once in config/binarySensorWords (binaryWord), which every surface reads. */
export interface BinarySensorClassInfo {
  icon: LucideIcon;
  /** Which state (if any) counts as this class's default "problem" state.
   *  "none" = purely informational, never auto-flagged as an alert. */
  alarmState: "on" | "off" | "none";
  /** true = a DETECTION (someone or something is there): its "on" glows its room on the map (detectsPresence), and it
   *  is never a fault — no line in "Needs attention" (alertIsFault). Absent = not one. */
  detects?: true;
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

  // ⚠️ A DETECTION IS RED, ON EVERY SURFACE (owner, 2026-10-21: "the entity badge to follow the state of the entity …
  // everywhere"): a motion or occupancy sensor's "on" was red in its window only (2026-10-05) and plain on the map.
  // The badge and its room chip read this table too now. ⚠️ BUT A DETECTION IS NO FAULT (owner, 2026-10-21, the same
  // day: "don't create a fault in cockpit when Motion sensor are triggered"): red, never a line in "Needs attention".
  motion: { icon: Activity, alarmState: "on", detects: true },
  moving: { icon: Activity, alarmState: "none", detects: true },
  occupancy: { icon: Eye, alarmState: "on", detects: true },
  // ⚠️ AN OPEN DOOR IS RED, ON EVERY SURFACE (owner, 2026-10-21: "make sure the 'open' pill appears with the alarming
  // style", then "the entity badge to follow the state of the entity"): an opening open, a lock sensor unlocked — its
  // badge, its window and "Needs attention" until it closes. It was information (2026-10-05: "an open window is not a
  // fault"), plain grey, then red in its window only (2.496.460) while its badge stayed plain.
  door: { icon: DoorOpen, alarmState: "on" },
  garage_door: { icon: DoorOpen, alarmState: "on" },
  window: { icon: DoorOpen, alarmState: "on" },
  opening: { icon: DoorOpen, alarmState: "on" },
  lock: { icon: Unlock, alarmState: "on" },
  // Informational — presence/state, not a fault, so never auto-alerts.
  presence: { icon: Home, alarmState: "none", detects: true },
  sound: { icon: Volume2, alarmState: "none" },
  vibration: { icon: Vibrate, alarmState: "none" },
  light: { icon: Lightbulb, alarmState: "none" },
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
 * place it is decided, from the device_class.
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
 * ⚠️ AND THEN THE WINDOW HAD A SECOND RULE (2026-10-05 to 2.496.460): a
 * detection, and an open door, were red in a sensor's window through
 * `colourAlertStateFor` while its badge read this one — the owner's open
 * laundry door: a red "Open" pill over a plain badge. One rule again, read by
 * the badge, the window, the history bar, the readings and "Needs attention".
 */
export function alertStateFor(deviceClass: string | undefined): string | undefined {
  const alarm = binarySensorClassInfo(deviceClass).alarmState;
  return alarm === "none" ? undefined : alarm;
}

/** Whether this sensor's problem state (alertStateFor) is a FAULT, a line in "Needs attention": every sensor but a
 *  detection (motion, occupancy), which is red on its badge and its window and listed nowhere (owner, 2026-10-21). */
export function alertIsFault(entityId: string, deviceClass: string | undefined): boolean {
  return !detectsPresence(entityId, deviceClass);
}

/** Whether this class is a DETECTION — motion, moving, occupancy, presence: its "on" glows its room on the map
 *  (EntityVisuals' room glow, beside a problem state "on": an open door glows its room too, owner 2026-10-21), and it
 *  is no fault (alertIsFault). */
export function detectsPresence(entityId: string, deviceClass: string | undefined): boolean {
  // ⚠️ ONE ANSWER, BY ITS CLASS OR — WITH NONE — ITS ID (isMotionSensor). This read the class only, so a sensor the
  // villa's system gives no class but names "…_pir" was a "Motion detected" toast AND a fault in "Needs attention"
  // each time someone walked past (architecture review, 2026-10-21).
  return isMotionSensor(entityId, deviceClass);
}

/** Whether this class's "on" glows its room on the map: a detection (someone there), or its problem state "on" — a
 *  door or window open, a leak. ⚠️ ANY "ON" GLOWED (owner, 2026-10-21: the laundry room red while its door sensor read
 *  Open — "keep it that way, it makes sense"), a connected access point or a plugged-in charger too: never good news. */
export function glowsRoom(entityId: string, deviceClass: string | undefined): boolean {
  return detectsPresence(entityId, deviceClass) || alertStateFor(deviceClass) === "on";
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
export const MOTION_DEVICE_CLASSES: ReadonlySet<string> = new Set(
  // the table's own `detects` flags: it was a second hand-written list beside them
  Object.keys(BINARY_SENSOR_CLASSES).filter((c) => BINARY_SENSOR_CLASSES[c].detects),
);
/** The id words that name a motion detector when HA reports no device_class.
 *  Anchored on "." / "_" / the ends ("_" is a word character, so `\b` would
 *  match "motion" inside "promotion_x"). */
export const MOTION_ID_HINT = /(^|[._])(motion|presence|occupancy|pir)([._]|$)/;
/** The id words that name a door/window/gate contact with no device_class. */
export const OPENING_ID_HINT = /(^|[._])(door|window|gate)([._]|$)/;

/** Is this binary_sensor a motion/presence detector: by its device_class,
 *  or — only when HA reports none — by its id. */
export function isMotionSensor(entityId: string, deviceClass: string | undefined): boolean {
  if (!isDomain(entityId, "binary_sensor")) return false;
  if (deviceClass) return MOTION_DEVICE_CLASSES.has(deviceClass);
  return MOTION_ID_HINT.test(entityId);
}
