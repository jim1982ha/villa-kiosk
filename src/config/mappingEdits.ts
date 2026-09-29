// src/config/mappingEdits.ts
// Every change to which device a map entry means, and how it is shown — as
// ONE module of pure edits.
//
// Each edit is a function of the LATEST config that returns the patch to
// apply, handed to `update()` (ConfigContext), which runs it against the
// config React actually holds at that moment. Before 2.496.224 the same
// "change one device's mapping" patch was rebuilt by hand at six places
// (Settings twice, the bindings table twice, the badge colour picker, the
// model's auto-detection) — two of them closing over a config that could
// already be out of date, so a second edit in the same moment erased the
// first. tests/oracles/mapping_edits.mjs drives every edit by value.

import type { AppConfig } from "./AppConfig";
import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import { createDefaultMapping } from "./EntityMap";
import { forgetEntities } from "./dismissedEntities";

/** A change to the config, computed from the config it applies to. */
export type ConfigEdit = (config: AppConfig) => Partial<AppConfig>;

/** Change some fields of one device's mapping. `fallback` is the mapping to
 *  start from when the entity has none stored yet (a panel opened on an
 *  entity the map only knows by its mesh). No mapping and no fallback:
 *  nothing changes. */
export function patchMapping(
  entityId: string, change: Partial<EntityMapping>, fallback?: EntityMapping,
): ConfigEdit {
  return (config) => {
    const prev = config.entityMap[entityId] ?? fallback;
    if (!prev) return {};
    return { entityMap: { ...config.entityMap, [entityId]: { ...prev, ...change } } };
  };
}

/** Add a default mapping for an entity not mapped yet (its label from Home
 *  Assistant's friendly name). An entity already mapped is left as it is. */
export function addMapping(entityId: string, entity?: Pick<HassEntity, "attributes">): ConfigEdit {
  return (config) => {
    if (!entityId || config.entityMap[entityId]) return {};
    return {
      entityMap: {
        ...config.entityMap,
        [entityId]: createDefaultMapping(entityId, {
          friendlyName: entity?.attributes.friendly_name as string | undefined,
        }),
      },
    };
  };
}

/**
 * Point a 3D object (the mesh named `oldKey`) at a different entity without
 * rebuilding the model: a mesh binding oldKey → newId, and the mapping moved
 * to newId (its settings kept). The mesh stays in the scene; only the entity
 * it controls changes.
 */
export function remapMapping(oldKey: string, newId: string): ConfigEdit {
  return (config) => {
    const entry = config.entityMap[oldKey];
    if (!newId || newId === oldKey || !entry) return {};
    const { [oldKey]: _moved, ...rest } = config.entityMap;
    return {
      entityMap: { ...rest, [newId]: { ...entry, entityId: newId } },
      meshBindings: { ...config.meshBindings, [oldKey]: newId },
    };
  };
}

/**
 * Adopt what the model detected (meshes named after an entity) — only
 * entities not mapped yet AND still known to Home Assistant. A mesh named
 * after an entity HA no longer reports used to come back into the map on
 * every load, even right after the owner removed it.
 */
export function adoptDetected(
  detected: readonly EntityMapping[], isLive: (entityId: string) => boolean,
): ConfigEdit {
  return (config) => {
    const additions: Record<string, EntityMapping> = {};
    for (const m of detected) {
      if (config.entityMap[m.entityId] || !isLive(m.entityId)) continue;
      additions[m.entityId] = m;
    }
    return Object.keys(additions).length ? { entityMap: { ...config.entityMap, ...additions } } : {};
  };
}

/** Bind a 3D object to an entity (replacing any binding it had), making sure
 *  the entity has a mapping. */
export function bindMesh(meshName: string, entityId: string, entity?: Pick<HassEntity, "attributes">): ConfigEdit {
  return (config) => ({
    meshBindings: { ...config.meshBindings, [meshName]: entityId },
    entityMap: addMapping(entityId, entity)(config).entityMap ?? config.entityMap,
  });
}

/** Unbind a 3D object. The entity's mapping is kept. */
export function unbindMesh(meshName: string): ConfigEdit {
  return (config) => {
    if (!(meshName in config.meshBindings)) return {};
    const { [meshName]: _gone, ...meshBindings } = config.meshBindings;
    return { meshBindings };
  };
}

/** Remove devices as ONE operation (see forgetEntities): the mapping goes
 *  AND the decision is recorded, so the model cannot bring them back. */
export function forgetMappings(ids: readonly string[]): ConfigEdit {
  return (config) => forgetEntities(config.entityMap, config.dismissedEntityIds, ids);
}
