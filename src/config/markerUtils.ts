// src/config/markerUtils.ts
// Helpers to add/remove floating markers and keep entityMap metadata in sync.

import type { AppConfig } from "./AppConfig";
import { createDefaultMapping, inferTypeFromEntityId, labelFromEntityId } from "./EntityMap";
import type { EntityType, SceneMarker, Vec3 } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";

function uuid(): string {
  return "mk-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Add a marker at a point, bound to an entity_id (which may not exist yet). */
export function addMarker(
  config: AppConfig,
  position: Vec3,
  entityId: string,
  floor: number,
  typeOverride?: EntityType,
  entity?: HassEntity,
): Pick<AppConfig, "markers" | "entityMap"> {
  const type = typeOverride ?? inferTypeFromEntityId(entityId) ?? "sensor";

  const marker: SceneMarker = {
    id: uuid(),
    entityId,
    type,
    label: labelFromEntityId(entityId, entity?.attributes.friendly_name),
    position,
    floor,
  };

  const entityMap = { ...config.entityMap };
  if (!entityMap[entityId]) {
    entityMap[entityId] = createDefaultMapping(entityId, {
      type,
      room: "Unmapped",
      friendlyName: entity?.attributes.friendly_name,
    });
  }

  return { markers: [...config.markers, marker], entityMap };
}

export function removeMarker(config: AppConfig, id: string): Pick<AppConfig, "markers"> {
  return { markers: config.markers.filter((m) => m.id !== id) };
}
