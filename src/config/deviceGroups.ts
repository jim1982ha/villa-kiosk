// src/config/deviceGroups.ts
// Manual device grouping: fold several HA entities that are really one
// physical device (e.g. a combo sensor exposing separate `_temperature`/
// `_humidity` entities) into a single map badge. See AppConfig.DeviceGroup
// for the shape and components/panels/DeviceGroupPanel for the combined view.

import type { AppConfig, DeviceGroup } from "./AppConfig";
import type { EntityMapping } from "@/types/scene.types";
import type { HassEntity } from "@/types/ha.types";
import { isUnavailable } from "@/utils/stateColors";
import { dismissedEntitySet } from "./dismissedEntities";

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
 * `..._humidity`. FALLBACK only — see suggestDeviceGroups: HA's own device
 * registry (entityDeviceIds) is the authoritative signal wherever it's
 * available, since it needs no naming convention and isn't limited to one
 * hardcoded pair of suffixes. This only still matters for an entity HA
 * doesn't (or can't) link to a device — a virtual/template helper, say. The
 * FIRST suffix in a pair becomes the suggested primary (its badge is the one
 * that stays on the map) — temperature reads as the more map-relevant glance
 * value of the two.
 */
const PAIRABLE_SUFFIXES: readonly [string, string][] = [
  ["_temperature", "_humidity"],
];

export interface DeviceGroupSuggestion {
  primaryEntityId: string;
  memberEntityId: string;
}

/**
 * Scan entityMap for same-device entities that aren't grouped yet —
 * surfaced in Advanced Settings as one-click "Group these" suggestions
 * rather than applied automatically, so an unrelated pair (or a name that
 * just happens to share a prefix) never silently disappears from the map.
 *
 * Two signals, in priority order:
 *   1. HA's own device registry (entityDeviceIds: entity_id -> device_id) —
 *      authoritative, needs no name matching, and naturally covers however
 *      many sibling entities one physical device exposes (a combo sensor's
 *      temperature/humidity/battery/battery_voltage/…, not just a
 *      hardcoded pair). A `_temperature` sibling is preferred as the
 *      suggested primary when one exists (same reasoning as the suffix
 *      fallback below); otherwise the alphabetically first, so the choice
 *      is deterministic rather than registry-fetch-order noise.
 *   2. The PAIRABLE_SUFFIXES name-matching fallback, for anything signal 1
 *      didn't cover — no device_id available at all (a profile without
 *      registry read access), or an entity HA itself doesn't attribute to
 *      any device.
 * Entities signal 1 already suggested a pairing for are skipped by signal 2,
 * so a device_id-linked pair is never suggested twice.
 */
export function suggestDeviceGroups(
  entityMap: Record<string, EntityMapping>,
  existingGroups: DeviceGroup[],
  entityDeviceIds: Record<string, string> = {},
): DeviceGroupSuggestion[] {
  const already = groupedEntityIds(existingGroups);
  const ids = Object.keys(entityMap);
  const idSet = new Set(ids);
  const suggestions: DeviceGroupSuggestion[] = [];
  const coveredByDeviceId = new Set<string>();

  const byDevice = new Map<string, string[]>();
  for (const id of ids) {
    const deviceId = entityDeviceIds[id];
    if (!deviceId || already.has(id)) continue;
    const list = byDevice.get(deviceId) ?? [];
    list.push(id);
    byDevice.set(deviceId, list);
  }
  for (const members of byDevice.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort();
    const primary = sorted.find((id) => id.endsWith("_temperature")) ?? sorted[0];
    for (const id of sorted) {
      if (id === primary) continue;
      suggestions.push({ primaryEntityId: primary, memberEntityId: id });
      coveredByDeviceId.add(id);
    }
  }

  for (const [primarySuffix, memberSuffix] of PAIRABLE_SUFFIXES) {
    for (const id of ids) {
      if (!id.endsWith(primarySuffix) || already.has(id) || coveredByDeviceId.has(id)) continue;
      const base = id.slice(0, -primarySuffix.length);
      const memberId = `${base}${memberSuffix}`;
      if (idSet.has(memberId) && !already.has(memberId) && !coveredByDeviceId.has(memberId)) {
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
/**
 * Every device the villa actually has, as ONE list: real, not hidden, not
 * dismissed, and folded so a multi-entity device appears once.
 *
 * This is the answer to "what may a person be shown or asked to pick", and it
 * exists because two surfaces disagreed about it in the field. The Facility
 * fault picker listed raw `entityMap` keys with only `disabled` filtered, so
 * it offered rows Home Assistant has never heard of — leftovers from a
 * renamed entity or an older model — presented exactly like real devices.
 * They were invisible everywhere else (Advanced Settings hides bound rows and
 * flags stale ones; the category modal drops dismissed ones), so the owner had
 * no way to reconcile "nothing unmapped in settings" with "unknown rooms in
 * the picker", and no way to tell which entry meant a real thing.
 *
 * Candidates come from the entity map AND the model's own meshes, for the
 * same reason unavailableDeviceIds does it: a device can legitimately be one
 * without the other. The rules:
 *   • `disabled` — the owner hid it;
 *   • CONFIG DEBRIS — no HA entity AND no geometry on the map. Not a device
 *     in error, just a key nothing has ever cleaned up;
 *   • dismissed — the owner removed it and HA still doesn't know it
 *     (see dismissedEntities for why that second half matters);
 *   • group members fold into their primary, so one physical device with
 *     three entities is one row.
 */
export function selectableDeviceIds(
  entityMap: Record<string, EntityMapping>,
  deviceGroups: DeviceGroup[],
  mappedEntityIds: ReadonlySet<string>,
  entities: Record<string, HassEntity>,
  dismissedEntityIds: readonly string[] = [],
): string[] {
  const dismissed = dismissedEntitySet(dismissedEntityIds, entities);
  const repOf = primaryByMember(entityMap, deviceGroups);
  const reps = new Set<string>();
  for (const id of new Set([...mappedEntityIds, ...Object.keys(entityMap)])) {
    if (entityMap[id]?.disabled) continue;
    if (!mappedEntityIds.has(id) && !entities[id]) continue;
    if (dismissed.has(id)) continue;
    reps.add(repOf.get(id) ?? id);
  }
  return [...reps];
}

/** member entity_id → the entity_id that REPRESENTS it on the map. Covers
 *  both explicit groups and the ones only suggested so far, so a device folds
 *  identically whether or not the owner has confirmed the grouping. */
function primaryByMember(
  entityMap: Record<string, EntityMapping>,
  deviceGroups: DeviceGroup[],
): Map<string, string> {
  const repOf = new Map<string, string>();
  for (const g of deviceGroups) {
    for (const memberId of g.memberEntityIds) repOf.set(memberId, g.primaryEntityId);
  }
  for (const s of suggestDeviceGroups(entityMap, deviceGroups)) {
    if (!repOf.has(s.memberEntityId)) repOf.set(s.memberEntityId, s.primaryEntityId);
  }
  return repOf;
}

export function unavailableDeviceIds(
  entityMap: Record<string, EntityMapping>,
  deviceGroups: DeviceGroup[],
  mappedEntityIds: ReadonlySet<string>,
  entities: Record<string, HassEntity>,
  /** See AppConfig.dismissedEntityIds. Deleting the entityMap row was never
   *  enough on its own: `candidates` below also draws from mappedEntityIds
   *  (mesh-derived), so an entity whose MESH still carries its name came
   *  straight back into this list the moment the owner removed it — on the
   *  very device that removed it, and on every other one. Reported as
   *  "I click Remove and they're still in Unavailable devices". */
  dismissedEntityIds: readonly string[] = [],
): string[] {
  // "Which real devices are currently offline" — the reality filter (hidden,
  // config debris, dismissed, group folding) is selectableDeviceIds' job, so
  // the two lists cannot drift apart. They did once: the fault picker had its
  // own, laxer idea of what counted as a device.
  return selectableDeviceIds(entityMap, deviceGroups, mappedEntityIds, entities,
                             dismissedEntityIds)
    .filter((id) => isUnavailable(entities[id]));
}
