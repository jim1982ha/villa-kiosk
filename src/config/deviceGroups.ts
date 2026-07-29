// src/config/deviceGroups.ts
// Manual device grouping: fold several HA entities that are really one
// physical device (e.g. a combo sensor exposing separate `_temperature`/
// `_humidity` entities) into a single map badge. See AppConfig.DeviceGroup
// for the shape and components/panels/DeviceGroupPanel for the combined view.

import type { AppConfig, DeviceGroup } from "./AppConfig";
import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import { isUnavailable } from "@/utils/stateColors";

/** Every entity_id folded into some group as a (non-primary) member — these
 *  never get their own badge; see EntityVisuals.rebuildLabels. */
export function groupMemberIds(groups: DeviceGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) for (const id of g.memberEntityIds) ids.add(id);
  return ids;
}

/** The group this entity_id represents on the map (undefined if it isn't a
 *  group's primary — including if it's a member of one). */
export function groupForPrimary(groups: DeviceGroup[], entityId: string): DeviceGroup | undefined {
  return groups.find((g) => g.primaryEntityId === entityId);
}

/** Every entity_id already spoken for by some group, either role — used to
 *  keep the Advanced Settings editor from adding the same entity twice. */
export function groupedEntityIds(groups: DeviceGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const g of groups) {
    ids.add(g.primaryEntityId);
    for (const id of g.memberEntityIds) ids.add(id);
  }
  return ids;
}

export function newGroupId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `group-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function upsertGroup(config: AppConfig, group: DeviceGroup): Pick<AppConfig, "deviceGroups"> {
  const i = config.deviceGroups.findIndex((g) => g.id === group.id);
  const deviceGroups = i === -1
    ? [...config.deviceGroups, group]
    : config.deviceGroups.map((g, idx) => (idx === i ? group : g));
  return { deviceGroups };
}

export function removeGroup(config: AppConfig, groupId: string): Pick<AppConfig, "deviceGroups"> {
  return { deviceGroups: config.deviceGroups.filter((g) => g.id !== groupId) };
}

/**
 * Suffix pairs that mark the same physical sensor exposed as two HA
 * entities, e.g. `sensor.living_room_foo_4217_temperature` +
 * `..._humidity`. The FIRST suffix in a pair becomes the suggested primary
 * (its badge is the one that stays on the map) — temperature reads as the
 * more map-relevant glance value of the two.
 */
const PAIRABLE_SUFFIXES: readonly [string, string][] = [
  ["_temperature", "_humidity"],
];

export interface DeviceGroupSuggestion {
  primaryEntityId: string;
  memberEntityId: string;
}

/**
 * Scan entityMap for same-device sensor pairs (identical entity_id apart
 * from a known suffix swap) that aren't grouped yet — surfaced in Advanced
 * Settings as one-click "Group these" suggestions rather than applied
 * automatically, so an unrelated pair (or a name that just happens to share
 * a prefix) never silently disappears from the map.
 */
export function suggestDeviceGroups(
  entityMap: Record<string, EntityMapping>,
  existingGroups: DeviceGroup[],
): DeviceGroupSuggestion[] {
  const already = groupedEntityIds(existingGroups);
  const ids = Object.keys(entityMap);
  const idSet = new Set(ids);
  const suggestions: DeviceGroupSuggestion[] = [];

  for (const [primarySuffix, memberSuffix] of PAIRABLE_SUFFIXES) {
    for (const id of ids) {
      if (!id.endsWith(primarySuffix) || already.has(id)) continue;
      const base = id.slice(0, -primarySuffix.length);
      const memberId = `${base}${memberSuffix}`;
      if (idSet.has(memberId) && !already.has(memberId)) {
        suggestions.push({ primaryEntityId: id, memberEntityId: memberId });
      }
    }
  }
  return suggestions;
}

/**
 * Every DEVICE Home Assistant currently reports as unavailable/unknown/
 * never-reported — "device", not "entity": multi-entity physical devices
 * (see PAIRABLE_SUFFIXES/DeviceGroup above) fold to ONE representative id,
 * and entries HA has never heard of and that have no map geometry are
 * dropped as config debris rather than counted as broken devices.
 *
 * THE single source of truth for this count/list — it used to be computed
 * twice (once inline in HUD's unavailable-devices button, once independently
 * in fm/readiness.ts's "All devices reporting" check), and the two
 * implementations disagreed: readiness counted raw entityMap candidates with
 * no folding or debris filtering, so a two-entity combo sensor could count as
 * two broken devices there while HUD's badge — reading straight off this
 * function — said one. An operator seeing "3 offline" on the Facility tab and
 * "1 offline" on the HUD badge has no way to know which number is real. Both
 * callers now go through this one function, so they cannot disagree again.
 */
export function unavailableDeviceIds(
  entityMap: Record<string, EntityMapping>,
  deviceGroups: DeviceGroup[],
  mappedEntityIds: ReadonlySet<string>,
  entities: Record<string, HassEntity>,
): string[] {
  const candidates = new Set([...mappedEntityIds, ...Object.keys(entityMap)]);

  const repOf = new Map<string, string>();
  for (const g of deviceGroups) {
    for (const memberId of g.memberEntityIds) repOf.set(memberId, g.primaryEntityId);
  }
  for (const s of suggestDeviceGroups(entityMap, deviceGroups)) {
    if (!repOf.has(s.memberEntityId)) repOf.set(s.memberEntityId, s.primaryEntityId);
  }

  const reps = new Set<string>();
  for (const id of candidates) {
    if (entityMap[id]?.disabled) continue;
    // Config debris: an entityMap entry HA has never heard of AND that has no
    // geometry on the map is not a device in error, it's a leftover key from
    // a renamed entity or an older model.
    if (!mappedEntityIds.has(id) && !entities[id]) continue;
    if (!isUnavailable(entities[id])) continue;
    reps.add(repOf.get(id) ?? id);
  }
  return [...reps];
}
