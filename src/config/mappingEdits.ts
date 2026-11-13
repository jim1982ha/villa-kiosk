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

import type { AppConfig, DeviceGroup } from "./AppConfig";
import type { EntityMapping, TeleportPoint } from "@/types/scene.types";
import { roomKey } from "./roomKey";
import type { HassEntity } from "@/types/ha.types";
import { SHOWS_NOTHING, createDefaultMapping, isOwnLabel, meshEntityOf, normaliseMeshName } from "./EntityMap";
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
 * "Point it there" (a 3D object whose entity is gone, in Devices): ONE "the device's id changed" edit over EVERY
 * reference the config holds to it. Every 3D object that shows `oldId` now shows `newId` — the object named after
 * the old id (bound by that name) AND every object bound to it by hand — and the device's settings
 * move with it, leaving no row behind (architecture review 2026-10-12, candidate 1: this was two
 * edits, remapMapping and repointObjects, and the second left `entityMap[oldId]` stranded); the owner's groups name the
 * new id where they named the old one (as the device or a member), every other device linked to it is linked to the new
 * one, and a device asleep by design stays so.
 *
 * ⚠️ THE GROUPS AND THE LINKS STAYED ON THE OLD ID (architecture review item 9, 2026-11-14): a re-pointed group's
 * device left a "Missing" card in the Cockpit for the old id, its members' readings on neither card, and the pill of a
 * device linked to it hollow. tests/oracles/mapping_edits.mjs holds every reference.
 *
 * ⚠️ THE NAME MOVES ONLY IF IT IS ONE (owner, 2026-10-12: a light re-pointed after its rename in HA
 * was titled with its OLD id over HA's "Patio2F Center"). The fallback made from the old id no
 * longer reads as a fallback under the new id, so it passed for the owner's own name everywhere.
 * With no name of the owner's, none is stored: the device is called by Home Assistant's live name.
 */
export function repointDevice(oldId: string, newId: string, entity?: Pick<HassEntity, "attributes">): ConfigEdit {
  return (config) => {
    if (!oldId || !newId || oldId === newId) return {};
    const meshBindings: Record<string, string> = { ...config.meshBindings, [oldId]: newId };
    for (const [mesh, id] of Object.entries(meshBindings)) if (id === oldId) meshBindings[mesh] = newId;
    const { [oldId]: entry, ...rest } = config.entityMap;
    const target = rest[newId] ?? createDefaultMapping(newId, {
      friendlyName: entity?.attributes.friendly_name as string | undefined,
    });
    const { label: oldLabel, ...settings } = entry ?? ({} as Partial<EntityMapping>);
    const { label: targetLabel, ...targetSettings } = target;
    const label = isOwnLabel(oldId, oldLabel) ? oldLabel
      : rest[newId] && isOwnLabel(newId, targetLabel) ? targetLabel : undefined;
    const moved = { ...targetSettings, ...settings, entityId: newId } as EntityMapping;
    if (label !== undefined) moved.label = label;
    // in the old id's place: the device keeps its place in the owner's order (deviceGroups.deviceFolding PLACED_ORDER)
    const entityMap: Record<string, EntityMapping> = {};
    for (const [id, m] of Object.entries(config.entityMap)) {
      if (id === oldId) entityMap[newId] = moved;
      else if (id !== newId) entityMap[id] = m;
    }
    if (!(newId in entityMap)) entityMap[newId] = moved;
    // every other device linked to it: linked to the new id (a device is never its own link)
    for (const [id, m] of Object.entries(entityMap)) {
      if (m.linkedEntityId !== oldId && !(id === newId && m.linkedEntityId === newId)) continue;
      const { linkedEntityId: _old, ...unlinked } = m;
      entityMap[id] = id === newId ? unlinked as EntityMapping : { ...m, linkedEntityId: newId };
    }
    const deviceGroups = renameInGroups(config.deviceGroups, oldId, newId);
    const asleep = config.unavailableByDesign.includes(oldId)
      ? { unavailableByDesign: [...new Set(config.unavailableByDesign.map((id) => (id === oldId ? newId : id)))] } : {};
    return { meshBindings, entityMap, ...(deviceGroups ? { deviceGroups } : {}), ...asleep };
  };
}

/** The owner's groups with `oldId` named `newId` (as a group's device or a member), each entity still in one group only
 *  (deviceGroups.groupEdit's rule): a member whose new id already stands in a group stays where that one stood; a
 *  group's device whose new id was a member somewhere becomes that group's device only. Null when no group names the
 *  old id. */
function renameInGroups(groups: readonly DeviceGroup[], oldId: string, newId: string): DeviceGroup[] | null {
  if (!groups.some((g) => g.primaryEntityId === oldId || g.memberEntityIds.includes(oldId))) return null;
  const stood = groups.some((g) => g.primaryEntityId === newId || g.memberEntityIds.includes(newId));
  const leads = groups.some((g) => g.primaryEntityId === oldId);
  return groups.map((g) => {
    const primaryEntityId = g.primaryEntityId === oldId ? newId : g.primaryEntityId;
    const memberEntityIds = g.memberEntityIds
      .flatMap((m) => (m === oldId ? (stood ? [] : [newId]) : m === newId && leads ? [] : [m]))
      .filter((m) => m !== primaryEntityId);
    return { ...g, primaryEntityId, memberEntityIds };
  });
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

/** The bindings without those of `object` (every part and pose of it: normaliseMeshName) that `drop` says go. */
function withoutObject(bindings: Record<string, string>, object: string, drop: (id: string) => boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(bindings).filter(([mesh, id]) => normaliseMeshName(mesh) !== object || !drop(id)));
}

/** A 3D object (its name without export suffixes) shows `entityId` — every part and pose of it, whatever it showed
 *  before ("Add a 3D object…" on a device's card) — and the entity has a mapping, so a device not on the map is on it. */
export function bindMesh(object: string, entityId: string, entity?: Pick<HassEntity, "attributes">): ConfigEdit {
  return (config) => ({
    meshBindings: { ...withoutObject(config.meshBindings, object, () => true), [object]: entityId },
    entityMap: addMapping(entityId, entity)(config).entityMap ?? config.entityMap,
  });
}

/** A 3D object taken off a device (its ✕ in the device's "3D object" field): its bindings to the device go, and when
 *  the map would still show a device on it (its name matches one), it shows nothing (SHOWS_NOTHING). The device's
 *  mapping is kept; an object that does not show the device is left as it is. */
export function takeObjectOff(object: string, entityId: string): ConfigEdit {
  return (config) => {
    const meshBindings = withoutObject(config.meshBindings, object, (id) => id === entityId);
    const unbound = Object.keys(meshBindings).length < Object.keys(config.meshBindings).length;
    if (!unbound && meshEntityOf(object, config.entityMap, config.meshBindings) !== entityId) return {};
    if (meshEntityOf(object, config.entityMap, meshBindings) !== null) meshBindings[object] = SHOWS_NOTHING;
    return { meshBindings };
  };
}

/** Remove devices as ONE operation (see forgetEntities): the mapping goes
 *  AND the decision is recorded, so the model cannot bring them back. */
export function forgetMappings(ids: readonly string[]): ConfigEdit {
  return (config) => forgetEntities(config.entityMap, config.dismissedEntityIds, ids);
}

/** A room or viewpoint added where the camera stands — refused (its words returned) when one of that name exists,
 *  whatever its case (roomKey: for comparing, never for storing — the name is kept as typed). Judged against the
 *  config as it is when the edit runs.
 *
 *  ⚠️ IT CLOSED OVER A CONFIG FROM EARLIER (architecture review scan 3, 2026-10-19): the room menu built the new list
 *  from the config it had captured — a calibration adopted or a pull from another device landing while it was open
 *  was written over, the very defect this module exists for. */
export function addRoom(point: TeleportPoint): { edit: ConfigEdit; clash: (config: AppConfig) => string | null } {
  const key = roomKey(point.name);
  const clash = (config: AppConfig) => {
    const c = config.teleportPoints.find((p) => roomKey(p.name) === key);
    return c ? `"${c.name}" already exists, remove or rename it first.` : null;
  };
  return { clash, edit: (config) => (clash(config) ? {} : { teleportPoints: [...config.teleportPoints, point] }) };
}

/** A room removed by its name, whatever case it was typed in (an older build stored duplicates: all go). */
export function removeRoom(name: string): ConfigEdit {
  const key = roomKey(name);
  return (config) => ({ teleportPoints: config.teleportPoints.filter((p) => roomKey(p.name) !== key) });
}
