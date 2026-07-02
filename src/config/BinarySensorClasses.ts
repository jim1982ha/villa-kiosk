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
// A per-entity Settings → Alert Thresholds override always wins over the
// `alarmState` default here (see SensorPanel.tsx) — this table only supplies
// the sensible starting point for a class the user hasn't customised.

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

export const BINARY_SENSOR_CLASSES: Record<string, BinarySensorClassInfo> = {
  // Actual hazards — "on" is the problem.
  moisture:        { onLabel: "Leak detected", offLabel: "No leak", icon: Droplets, alarmState: "on" },
  smoke:           { onLabel: "Smoke detected", offLabel: "Clear", icon: Flame, alarmState: "on" },
  gas:             { onLabel: "Gas detected", offLabel: "Clear", icon: Wind, alarmState: "on" },
  carbon_monoxide: { onLabel: "CO detected", offLabel: "Clear", icon: Wind, alarmState: "on" },
  safety:          { onLabel: "Unsafe", offLabel: "Safe", icon: ShieldAlert, alarmState: "on" },
  problem:         { onLabel: "Problem", offLabel: "OK", icon: AlertTriangle, alarmState: "on" },
  tamper:          { onLabel: "Tampered", offLabel: "Clear", icon: ShieldAlert, alarmState: "on" },
  heat:            { onLabel: "Hot", offLabel: "Normal", icon: Thermometer, alarmState: "on" },
  cold:            { onLabel: "Cold", offLabel: "Normal", icon: Snowflake, alarmState: "on" },
  battery:         { onLabel: "Low", offLabel: "Normal", icon: BatteryWarning, alarmState: "on" },
  // Concerning when OFF, not on.
  connectivity:    { onLabel: "Connected", offLabel: "Disconnected", icon: Wifi, alarmState: "off" },

  // Informational — presence/state, not a fault, so never auto-alerts.
  motion:            { onLabel: "Motion detected", offLabel: "Clear", icon: Activity, alarmState: "none" },
  moving:            { onLabel: "Moving", offLabel: "Not moving", icon: Activity, alarmState: "none" },
  occupancy:         { onLabel: "Occupied", offLabel: "Clear", icon: Eye, alarmState: "none" },
  presence:          { onLabel: "Home", offLabel: "Away", icon: Home, alarmState: "none" },
  sound:             { onLabel: "Sound detected", offLabel: "Clear", icon: Volume2, alarmState: "none" },
  vibration:         { onLabel: "Vibration detected", offLabel: "Clear", icon: Vibrate, alarmState: "none" },
  light:             { onLabel: "Light detected", offLabel: "No light", icon: Lightbulb, alarmState: "none" },
  door:              { onLabel: "Open", offLabel: "Closed", icon: DoorOpen, alarmState: "none" },
  garage_door:       { onLabel: "Open", offLabel: "Closed", icon: DoorOpen, alarmState: "none" },
  window:            { onLabel: "Open", offLabel: "Closed", icon: DoorOpen, alarmState: "none" },
  opening:           { onLabel: "Open", offLabel: "Closed", icon: DoorOpen, alarmState: "none" },
  lock:              { onLabel: "Unlocked", offLabel: "Locked", icon: Unlock, alarmState: "none" },
  plug:              { onLabel: "Plugged in", offLabel: "Unplugged", icon: Plug, alarmState: "none" },
  running:           { onLabel: "Running", offLabel: "Not running", icon: Activity, alarmState: "none" },
  battery_charging:  { onLabel: "Charging", offLabel: "Not charging", icon: BatteryCharging, alarmState: "none" },
  update:            { onLabel: "Update available", offLabel: "Up to date", icon: RefreshCw, alarmState: "none" },
};

export function binarySensorClassInfo(deviceClass?: string): BinarySensorClassInfo {
  if (!deviceClass) return DEFAULT_INFO;
  return BINARY_SENSOR_CLASSES[deviceClass] ?? DEFAULT_INFO;
}
