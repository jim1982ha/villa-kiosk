// src/babylon/badgeIconKeys.ts
// Which badgeIconNodes.ts glyph each entity gets — hardcoded (see
// badgeIcons.ts for the rest of the design: fixed category background,
// thick white line art, no per-user customisation). binary_sensor keys
// mirror config/BinarySensorClasses.ts's own icon choices (used for the
// device panel) so a device_class reads the same glyph in both places.

import type { EntityType } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";

/** One glyph per entity TYPE — the fallback for binary_sensor/sensor when no
 *  (or an unrecognised) device_class is reported. */
export const TYPE_ICON_KEY: Record<EntityType, string> = {
  light: "lightbulb",
  climate: "thermometer",
  lock: "lock",
  camera: "camera",
  cover: "blinds",
  fan: "fan",
  binary_sensor: "activity",
  sensor: "gauge",
  media_player: "music",
  switch: "power",
  input_boolean: "toggleLeft",
  assist_satellite: "mic",
};

/** device_class -> glyph, for binary_sensor entities. Mirrors
 *  BinarySensorClasses.ts's own icon per class. */
export const BINARY_SENSOR_ICON_KEY: Record<string, string> = {
  moisture: "droplets",
  smoke: "flame",
  gas: "wind",
  carbon_monoxide: "wind",
  safety: "shieldAlert",
  problem: "alertTriangle",
  tamper: "shieldAlert",
  heat: "thermometer",
  cold: "snowflake",
  battery: "batteryWarning",
  connectivity: "wifi",
  motion: "activity",
  moving: "activity",
  occupancy: "eye",
  presence: "home",
  sound: "volume2",
  vibration: "vibrate",
  light: "lightbulb",
  door: "doorOpen",
  garage_door: "doorOpen",
  window: "doorOpen",
  opening: "doorOpen",
  lock: "unlock",
  plug: "plug",
  running: "activity",
  battery_charging: "batteryCharging",
  update: "refreshCw",
};

/** device_class -> glyph, for sensor entities. */
export const SENSOR_ICON_KEY: Record<string, string> = {
  temperature: "thermometer",
  humidity: "droplets",
  power: "zap",
  energy: "batteryCharging",
  current: "zap",
  voltage: "zap",
  battery: "battery",
  illuminance: "sun",
  pressure: "gauge",
  gas: "wind",
  carbon_dioxide: "wind",
  volatile_organic_compounds: "wind",
  pm25: "wind",
  signal_strength: "signal",
  timestamp: "clock",
  duration: "timer",
};

/** Resolve the badge glyph key for an entity — device_class override (for the
 *  two catch-all domains) falling back to the per-type default. */
export function iconKeyFor(type: EntityType, entity?: HassEntity): string {
  const dc = entity?.attributes?.device_class as string | undefined;
  if (type === "binary_sensor" && dc) {
    const key = BINARY_SENSOR_ICON_KEY[dc];
    if (key) return key;
  }
  if (type === "sensor" && dc) {
    const key = SENSOR_ICON_KEY[dc];
    if (key) return key;
  }
  return TYPE_ICON_KEY[type] ?? "gauge";
}
