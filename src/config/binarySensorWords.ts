// src/config/binarySensorWords.ts
// HOW A binary_sensor's "on" AND "off" READ, per device_class — the words
// Home Assistant shows ("Normal" / "Low" for a battery, "No leak" / "Leak
// detected" for moisture). No imports: utils/entityValue (every row, list and
// badge reading) and config/BinarySensorClasses (the panel's pill, icon and
// alarm state) both read it — tests/oracles/binary_words.mjs.
//
// ⚠️ THE ROWS SAID "Off" WHERE HOME ASSISTANT SAYS "Normal" (owner,
// 2026-10-05, a leak sensor's battery). The words lived only in
// BinarySensorClasses, which imports entityValue — so entityValue, the one
// formatter of every reading's text, could not reach them, and every list
// row, "Also on this device" and the badge read a binary sensor as On / Off.

/** [on, off] per device_class; a class not listed reads "On" / "Off". */
export const BINARY_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  moisture: ["Leak detected", "No leak"],
  smoke: ["Smoke detected", "Clear"],
  gas: ["Gas detected", "Clear"],
  carbon_monoxide: ["CO detected", "Clear"],
  safety: ["Unsafe", "Safe"],
  problem: ["Problem", "OK"],
  tamper: ["Tampered", "Clear"],
  heat: ["Hot", "Normal"],
  cold: ["Cold", "Normal"],
  battery: ["Low", "Normal"],
  connectivity: ["Connected", "Disconnected"],
  motion: ["Motion detected", "Clear"],
  moving: ["Moving", "Not moving"],
  occupancy: ["Occupied", "Clear"],
  presence: ["Home", "Away"],
  sound: ["Sound detected", "Clear"],
  vibration: ["Vibration detected", "Clear"],
  light: ["Light detected", "No light"],
  door: ["Open", "Closed"],
  garage_door: ["Open", "Closed"],
  window: ["Open", "Closed"],
  opening: ["Open", "Closed"],
  lock: ["Unlocked", "Locked"],
  plug: ["Plugged in", "Unplugged"],
  running: ["Running", "Not running"],
  battery_charging: ["Charging", "Not charging"],
  update: ["Update available", "Up to date"],
};

/** The word for a binary_sensor's on/off state; null for any other state
 *  (unavailable, unknown — those keep their own words) or another domain. */
export function binaryWord(entityId: string, deviceClass: unknown, state: string): string | null {
  if (!entityId.startsWith("binary_sensor.") || (state !== "on" && state !== "off")) return null;
  const w = BINARY_WORDS[String(deviceClass ?? "")] ?? ["On", "Off"];
  return state === "on" ? w[0] : w[1];
}
