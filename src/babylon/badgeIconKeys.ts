// src/babylon/badgeIconKeys.ts
// Which badgeIconNodes.ts glyph each entity gets — hardcoded (see
// badgeIcons.ts for the rest of the design: fixed category background,
// thick white line art, no per-user customisation). binary_sensor keys
// mirror config/BinarySensorClasses.ts's own icon choices (used for the
// device panel) so a device_class reads the same glyph in both places. Plain
// sensor keys mirror config/SensorClasses.ts's SENSOR_CLASS_ICON the same way
// — both resolve through that module's effectiveSensorClass() first, so a
// sensor with no device_class (inferred from its unit instead) still agrees
// between its 3D badge and its panel.

import type { EntityType } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import { effectiveSensorClass } from "@/config/SensorClasses";

/** One glyph per entity TYPE — the fallback for binary_sensor/sensor when no
 *  (or an unrecognised) device_class is reported. */
export const TYPE_ICON_KEY: Record<EntityType, string> = {
  light: "lightbulb",
  climate: "thermometer",
  lock: "lock",
  camera: "cctv",
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

/** device_class -> glyph, for switch entities (HA defines just these two). */
export const SWITCH_ICON_KEY: Record<string, string> = {
  outlet: "plug",
  switch: "power",
};

/** `switch` is HA's generic RELAY domain: a pool pump, a lamp relay, a motion
 *  detector's enable toggle and a lock relay are all plain `switch.*` with no
 *  device_class, so they all resolved to the one "power" glyph — a wall of
 *  identical icons with nothing to tell them apart (very visible in the
 *  bottom-bar group modals). A switch's PURPOSE is normally evident from its
 *  name, so fall back to a name hint before the generic default. Ordered:
 *  first match wins, most specific first. Applies to switch/input_boolean
 *  only — every other domain already has a meaningful per-type or
 *  per-device_class glyph above. */
const SWITCH_NAME_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/motion|presence|occupan|detect/i, "activity"],
  [/\block|unlock|door|gate/i, "lock"],
  [/light|lamp|\bled\b|spot/i, "lightbulb"],
  [/fan|vmc|extract|vent/i, "fan"],
  [/pump|filtr|filter|jet|jacuzzi|spa|pool/i, "droplets"],
  [/heat|boiler|water_?heater|thermo/i, "thermometer"],
  [/camera|cctv/i, "cctv"],
  [/speaker|music|audio|sonos/i, "music"],
  [/plug|socket|outlet/i, "plug"],
];

/** Resolve the badge glyph key for an entity — device_class override (for the
 *  catch-all domains) then a name hint (for generic relays), falling back to
 *  the per-type default. ONE resolver for every surface that draws an entity
 *  icon (3D badges, panel headers, the bottom-bar group modals), so a device
 *  reads the same glyph everywhere. */
export function iconKeyFor(type: EntityType, entity?: HassEntity): string {
  const dc = entity?.attributes?.device_class as string | undefined;
  if (type === "binary_sensor" && dc) {
    const key = BINARY_SENSOR_ICON_KEY[dc];
    if (key) return key;
  }
  if (type === "sensor") {
    const unit = entity?.attributes?.unit_of_measurement as string | undefined;
    const effectiveClass = effectiveSensorClass(dc, unit);
    const key = effectiveClass ? SENSOR_ICON_KEY[effectiveClass] : undefined;
    if (key) return key;
  }
  if (type === "switch" || type === "input_boolean") {
    if (dc) {
      const key = SWITCH_ICON_KEY[dc];
      if (key) return key;
    }
    // Match the friendly name AND the entity_id — the id often carries the
    // purpose ("switch.swimming_pool_light_led_...") even when the friendly
    // name has been shortened.
    const haystack = `${(entity?.attributes?.friendly_name as string | undefined) ?? ""} ${entity?.entity_id ?? ""}`;
    for (const [re, key] of SWITCH_NAME_HINTS) {
      if (re.test(haystack)) return key;
    }
  }
  return TYPE_ICON_KEY[type] ?? "gauge";
}
