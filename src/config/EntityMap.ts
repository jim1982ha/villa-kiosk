// src/config/EntityMap.ts
//
// Maps GLB mesh names -> HA entity metadata.
//
// IMPORTANT: In TheLysHouse model the interactive objects were named in
// SweetHome 3D *with their full HA entity_id* (e.g. "camera.livingroom_cam",
// "climate.living_room_air_conditioner"). So the primary key here is the
// entity_id itself, and `resolveMeshToMapping()` (see below) matches a tapped
// mesh by entity_id, by the spec's "[type]_[room]" alias, or by a sanitised
// form (dots -> underscores, which is what some glTF exporters emit).
//
// Entity IDs may change as devices are added — the in-app Config Editor edits a
// copy of this map stored in localStorage, so no code change is required.

import type { EntityMapping, EntityType } from "@/types/scene.types";

export type { EntityMapping, EntityType };

/** Default mapping keyed by HA entity_id. */
export const ENTITY_MAP: Record<string, EntityMapping> = {
  // === CAMERAS ===
  "camera.garden_public_wall_cam": {
    entityId: "camera.garden_public_wall_cam",
    type: "camera", label: "Garden Wall Camera", room: "Garden",
  },
  "camera.patio_1f_cam": {
    entityId: "camera.patio_1f_cam",
    type: "camera", label: "Patio Camera", room: "Patio",
  },
  "camera.garden_and_terrace_cam": {
    entityId: "camera.garden_and_terrace_cam",
    type: "camera", label: "Garden & Terrace Camera", room: "Garden",
  },
  "camera.main_house_door_cam": {
    entityId: "camera.main_house_door_cam",
    type: "camera", label: "Main Door Camera", room: "Entrance",
  },
  "camera.swimming_pool_cam": {
    entityId: "camera.swimming_pool_cam",
    type: "camera", label: "Pool Camera", room: "Pool",
  },
  "camera.livingroom_cam": {
    entityId: "camera.livingroom_cam",
    type: "camera", label: "Living Room Camera", room: "Living Room",
  },
  "camera.parking_gate_cam": {
    entityId: "camera.parking_gate_cam",
    type: "camera", label: "Parking Gate Camera", room: "Parking",
  },
  "camera.kitchen_cam": {
    entityId: "camera.kitchen_cam",
    type: "camera", label: "Kitchen Camera", room: "Kitchen",
  },
  "camera.patio_terrace_cam": {
    entityId: "camera.patio_terrace_cam",
    type: "camera", label: "Patio Terrace Camera", room: "Terrace",
  },

  // === CLIMATE / AC ===
  "climate.living_room_air_conditioner": {
    entityId: "climate.living_room_air_conditioner",
    type: "climate", label: "Living Room AC", room: "Living Room",
  },

  // === COVERS (CURTAINS) ===
  "cover.curtain_living_room_big": {
    entityId: "cover.curtain_living_room_big",
    type: "cover", label: "Living Room Curtain (Big)", room: "Living Room",
  },
  "cover.curtain_living_room_small": {
    entityId: "cover.curtain_living_room_small",
    type: "cover", label: "Living Room Curtain (Small)", room: "Living Room",
  },
  "cover.curtain_living_room_medium": {
    entityId: "cover.curtain_living_room_medium",
    type: "cover", label: "Living Room Curtain (Medium)", room: "Living Room",
  },
  "cover.curtain_bedroom_1": {
    entityId: "cover.curtain_bedroom_1",
    type: "cover", label: "Bedroom 1 Curtain", room: "Bedroom 1",
  },
  "cover.curtain_master_bedroom": {
    entityId: "cover.curtain_master_bedroom",
    type: "cover", label: "Master Bedroom Curtain", room: "Master Bedroom",
  },

  // === FANS ===
  "fan.guest_bathroom_guest_bathroom_fan": {
    entityId: "fan.guest_bathroom_guest_bathroom_fan",
    type: "fan", label: "Guest Bathroom Fan", room: "Guest Bathroom",
  },
  "fan.master_bedroom_master_bathroom_wallswitch_center": {
    entityId: "fan.master_bedroom_master_bathroom_wallswitch_center",
    type: "fan", label: "Master Bathroom Fan", room: "Master Bathroom",
  },

  // === LOCKS ===
  "lock.living_room_aqara_smart_door_lock_0aa9_lock_mechanism": {
    entityId: "lock.living_room_aqara_smart_door_lock_0aa9_lock_mechanism",
    type: "lock", label: "Front Door Lock", room: "Entrance",
    requiresConfirmation: true,
  },

  // === BINARY SENSORS ===
  "binary_sensor.water_leak_water_heater_1f_water_leak": {
    entityId: "binary_sensor.water_leak_water_heater_1f_water_leak",
    type: "binary_sensor", label: "Water Heater Leak Sensor", room: "Utility",
  },

  // === SENSORS ===
  "sensor.sensor_t1_temperature": {
    entityId: "sensor.sensor_t1_temperature",
    type: "sensor", label: "Temperature Sensor T1", room: "Guest Bathroom",
  },

  // === MEDIA ===
  "media_player.tv": {
    entityId: "media_player.tv",
    type: "media_player", label: "TV", room: "Living Room",
  },

  // === ASSIST SATELLITE ===
  "assist_satellite.macbook_satellite": {
    entityId: "assist_satellite.macbook_satellite",
    type: "assist_satellite", label: "MacBook Satellite", room: "Living Room",
  },
};

/**
 * Alias table for the spec's "[type]_[room]" Blender naming convention, in case
 * a future model uses those names instead of raw entity_ids.
 */
export const MESH_ALIASES: Record<string, string> = {
  camera_garden_wall: "camera.garden_public_wall_cam",
  camera_patio_1f: "camera.patio_1f_cam",
  camera_garden_terrace: "camera.garden_and_terrace_cam",
  camera_main_door: "camera.main_house_door_cam",
  camera_pool: "camera.swimming_pool_cam",
  camera_living_room: "camera.livingroom_cam",
  camera_parking: "camera.parking_gate_cam",
  camera_kitchen: "camera.kitchen_cam",
  camera_patio_terrace: "camera.patio_terrace_cam",
  ac_living_room: "climate.living_room_air_conditioner",
  cover_living_room_big: "cover.curtain_living_room_big",
  cover_living_room_small: "cover.curtain_living_room_small",
  cover_living_room_medium: "cover.curtain_living_room_medium",
  cover_bedroom_1: "cover.curtain_bedroom_1",
  cover_master_bedroom: "cover.curtain_master_bedroom",
  fan_guest_bathroom: "fan.guest_bathroom_guest_bathroom_fan",
  fan_master_bathroom: "fan.master_bedroom_master_bathroom_wallswitch_center",
  lock_front_door: "lock.living_room_aqara_smart_door_lock_0aa9_lock_mechanism",
  sensor_water_heater_1f: "binary_sensor.water_leak_water_heater_1f_water_leak",
  sensor_t1_temperature: "sensor.sensor_t1_temperature",
  media_tv: "media_player.tv",
  assist_macbook: "assist_satellite.macbook_satellite",
};

/** Infer a panel/entity type from an entity_id domain prefix. */
export function inferTypeFromEntityId(entityId: string): EntityType | null {
  const domain = entityId.split(".")[0];
  const known: EntityType[] = [
    "light", "climate", "lock", "camera", "cover", "fan",
    "binary_sensor", "sensor", "media_player", "switch", "assist_satellite",
  ];
  return (known as string[]).includes(domain) ? (domain as EntityType) : null;
}

/** Build a usable EntityMapping for an entity_id, falling back to inference. */
export function mappingForEntityId(
  entityId: string,
  map: Record<string, EntityMapping>,
): EntityMapping | null {
  if (map[entityId]) return map[entityId];
  const inferred = inferTypeFromEntityId(entityId);
  if (!inferred) return null;
  return {
    entityId,
    type: inferred,
    label: entityId.split(".")[1]?.replace(/_/g, " ") ?? entityId,
    room: "Unmapped",
  };
}

/** Normalise a Babylon/glTF mesh name (strip ".001", "_primitive0", "(clone)"). */
export function normaliseMeshName(meshName: string): string {
  return meshName
    .replace(/_primitive\d+$/i, "")
    .replace(/\.\d{3}$/, "")
    .replace(/\s*\(clone\)$/i, "")
    .trim();
}

/**
 * Resolve a tapped mesh name to an EntityMapping using several strategies, in
 * priority order. Returns null for non-interactive meshes (walls, furniture).
 *
 * Strategy order:
 *   0) explicit user binding (meshName -> entity_id) — the turnkey path,
 *   1-4) name-based matching (mesh named with the entity_id / alias / inferred).
 */
export function resolveMeshToMapping(
  meshName: string,
  map: Record<string, EntityMapping> = ENTITY_MAP,
  bindings: Record<string, string> = {},
): EntityMapping | null {
  if (!meshName) return null;

  const base = normaliseMeshName(meshName);

  // 0) Explicit binding wins (raw name or normalised name).
  const boundId = bindings[meshName] ?? bindings[base];
  if (boundId) return mappingForEntityId(boundId, map);

  // 1) Exact entity_id match (mesh named with the entity_id).
  if (map[base]) return map[base];

  // 2) Spec alias "[type]_[room]".
  if (MESH_ALIASES[base] && map[MESH_ALIASES[base]]) return map[MESH_ALIASES[base]];

  // 3) Sanitised form: some exporters turn "camera.livingroom_cam" into
  //    "camera_livingroom_cam". Re-insert the first underscore as a dot.
  const firstUnderscore = base.indexOf("_");
  if (firstUnderscore > 0) {
    const candidate = base.slice(0, firstUnderscore) + "." + base.slice(firstUnderscore + 1);
    if (map[candidate]) return map[candidate];
  }

  // 4) Looks like an entity_id we simply don't have metadata for yet — build a
  //    minimal mapping so it is still tappable (graceful unknown-entity handling).
  const inferred = inferTypeFromEntityId(base);
  if (inferred) {
    return {
      entityId: base,
      type: inferred,
      label: base.split(".")[1]?.replace(/_/g, " ") ?? base,
      room: "Unmapped",
    };
  }

  return null;
}

/** Reverse lookup: entity_id -> [meshKey, mapping]. */
export function getMappingByEntityId(
  entityId: string,
  map: Record<string, EntityMapping> = ENTITY_MAP,
): [string, EntityMapping] | null {
  const entry = Object.entries(map).find(([, v]) => v.entityId === entityId);
  return entry ?? null;
}
