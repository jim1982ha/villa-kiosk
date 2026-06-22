// src/config/bindingUtils.ts
// Helpers to create/remove mesh->entity bindings and keep entityMap metadata in
// sync. Used by the tap-to-bind dialog and the Config page bindings table.

import type { AppConfig } from "./AppConfig";
import { inferTypeFromEntityId } from "./EntityMap";
import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";

/** Add/replace a binding meshName -> entityId, ensuring metadata exists. */
export function upsertBinding(
  config: AppConfig,
  meshName: string,
  entityId: string,
  entity?: HassEntity,
): Pick<AppConfig, "meshBindings" | "entityMap"> {
  const meshBindings = { ...config.meshBindings, [meshName]: entityId };

  const entityMap = { ...config.entityMap };
  if (!entityMap[entityId]) {
    const type = inferTypeFromEntityId(entityId) ?? "sensor";
    entityMap[entityId] = {
      entityId,
      type,
      label: entity?.attributes.friendly_name ?? entityId.split(".")[1]?.replace(/_/g, " ") ?? entityId,
      room: "Unmapped",
      ...(type === "lock" ? { requiresConfirmation: true } : {}),
    } as EntityMapping;
  }
  return { meshBindings, entityMap };
}

/** Remove the binding for a mesh (entityMap metadata is left intact). */
export function removeBinding(config: AppConfig, meshName: string): Pick<AppConfig, "meshBindings"> {
  const meshBindings = { ...config.meshBindings };
  delete meshBindings[meshName];
  return { meshBindings };
}
