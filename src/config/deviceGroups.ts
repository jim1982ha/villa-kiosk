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
import { domainOf } from "@/utils/entityDomain";

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
function selectableDeviceIds(
  entityMap: Record<string, EntityMapping>,
  mappedEntityIds: ReadonlySet<string>,
  entities: Record<string, HassEntity>,
  dismissedEntityIds: readonly string[],
  repOf: ReadonlyMap<string, string>,
): string[] {
  const dismissed = dismissedEntitySet(dismissedEntityIds, entities);
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
export function deviceFolding(
  entityMap: Record<string, EntityMapping>,
  deviceGroups: readonly DeviceGroup[],
  entityDeviceIds: Record<string, string>,
): Map<string, string> {
  const repOf = new Map<string, string>();
  for (const g of deviceGroups) {
    for (const memberId of g.memberEntityIds) repOf.set(memberId, g.primaryEntityId);
  }
  // ⚠️ THE REGISTRY IS PASSED NOW, AND IT USED NOT TO BE. This called
  // `suggestDeviceGroups(entityMap, deviceGroups)` with the third argument
  // omitted, so the fold behind the fault picker, the offline count and
  // readiness fell back to matching one hardcoded `_temperature`/`_humidity`
  // suffix pair — while Advanced Settings, which DOES pass it, folded by Home
  // Assistant's own device registry. A combo sensor HA links by `device_id`
  // but whose entities do not match that pair was ONE device in Settings and
  // TWO in the offline count: exactly the drift `unavailableDeviceIds`'
  // docstring claims was paid for and ended.
  for (const s of suggestDeviceGroups(entityMap, [...deviceGroups], entityDeviceIds)) {
    if (!repOf.has(s.memberEntityId)) repOf.set(s.memberEntityId, s.primaryEntityId);
  }
  // ⚠️ AN ENTITY THAT IS NOT ON THE MAP STILL BELONGS TO ITS DEVICE (2.496.258).
  // The fold used to cover only entityMap keys, so a reading the owner never
  // placed — a pump's energy meter beside its placed power sensor — was a
  // device of its own: the agent's "used 0.09 kWh/day" ticket on it stood
  // alone in Cockpit with no room, and tapping it opened the meter instead of
  // the pump the map shows. Home Assistant's registry says which device it is;
  // it folds to that device's representative. Only unplaced ids are added, and
  // every count (selectableDeviceIds) walks placed ids, so no number moves.
  const repOfDevice = new Map<string, string>();
  for (const id of Object.keys(entityMap).sort()) {
    const deviceId = entityDeviceIds[id];
    if (!deviceId || entityMap[id]?.disabled || repOfDevice.has(deviceId)) continue;
    repOfDevice.set(deviceId, repOf.get(id) ?? id);
  }
  for (const [id, deviceId] of Object.entries(entityDeviceIds)) {
    if (entityMap[id] || repOf.has(id)) continue;
    const rep = repOfDevice.get(deviceId);
    if (rep && rep !== id) repOf.set(id, rep);
  }
  return repOf;
}

/**
 * THE villa's own devices, as one value.
 *
 * ⚠️ IT WAS A FIVE-POSITIONAL-ARGUMENT TUPLE RESTATED AT TWELVE CALL SITES,
 * and three functions re-ordered the same nouns three different ways
 * (`selectableDeviceIds`, `unavailableDeviceIds`, `buildReadiness`,
 * `buildDeviceOptions`). Four of the five arguments were slices of one config
 * document; the caller had to know as much to ask the question as this module
 * knows to answer it, which is no leverage at all. `FacilityModal` alone
 * reassembled the tuple five times, each with its own matching dependency
 * array.
 *
 * ⚠️ AND TWO OF THOSE ARGUMENTS DEFAULTED TO EMPTY, so a forgotten one
 * silently resurrected dismissed devices rather than failing. Every field here
 * is required. `entityDeviceIds` in particular was not merely defaulted but
 * genuinely dropped on the path the fault picker, the offline count and
 * readiness all take — see primaryByMember.
 */
export interface VillaDeviceInput {
  entityMap: Record<string, EntityMapping>;
  deviceGroups: readonly DeviceGroup[];
  /** See AppConfig.dismissedEntityIds. */
  dismissedEntityIds: readonly string[];
  /** Entity ids the 3D model itself carries — a device can be one of these
   *  without Home Assistant knowing it, and vice versa. */
  mappedEntityIds: ReadonlySet<string>;
  entities: Record<string, HassEntity>;
  /** Home Assistant's own device registry, entity_id → device_id. The
   *  AUTHORITATIVE folding signal: it needs no naming convention and covers
   *  however many entities one physical device exposes. */
  entityDeviceIds: Record<string, string>;
  /** deviceFolding(entityMap, deviceGroups, entityDeviceIds), when the caller
   *  holds it. It depends on CONFIG only, never on a state push, and the
   *  villa model asked for it twice per push (2.496.197). */
  folding?: ReadonlyMap<string, string>;
}

export interface VillaDevices {
  /** Every device the villa actually has — real, not hidden, not dismissed,
   *  folded so a multi-entity device appears once. */
  readonly ids: readonly string[];
  /** The subset Home Assistant currently reports as unavailable/unknown or
   *  has never heard report. */
  readonly unavailable: readonly string[];
  /** Is this entity one of the villa's devices? Provided so callers stop
   *  building their own `Set` from `ids` — five of them did. */
  has(entityId: string): boolean;
}

export function villaDevices(input: VillaDeviceInput): VillaDevices {
  const ids = selectableDeviceIds(
    input.entityMap, input.mappedEntityIds, input.entities, input.dismissedEntityIds,
    input.folding ?? deviceFolding(input.entityMap, input.deviceGroups, input.entityDeviceIds));
  const set = new Set(ids);
  return {
    ids,
    // "Which real devices are currently offline" — the reality filter
    // (hidden, config debris, dismissed, group folding) is the list above's
    // job, so the two cannot drift apart. They did once: the fault picker had
    // its own, laxer idea of what counted as a device.
    unavailable: ids.filter((id) => isUnavailable(input.entities[id])),
    has: (id) => set.has(id),
  };
}

// ── One identity for every opener (2.496.260) ──────────────────────────────
// ⚠️ THREE ANSWERS TO "WHICH DEVICE IS THIS". The panel router and the map
// knew explicit groups only; Cockpit and the counts the full fold above; and
// every other opener — the Agent, Facility, the device lists — the raw entity
// id. So the Onsen pump's energy-meter fault opened the meter in one place
// and the pump in another, Settings listed that meter as "not shown
// anywhere", and accepting a group swapped a lock's controls for a read-only
// summary. These answer it once, from the fold.

/** The entity that stands for `id`'s device — what a tap on anything of that
 *  device opens. Itself when it is its own device. */
export function deviceOf(folding: ReadonlyMap<string, string>, id: string): string {
  return folding.get(id) ?? id;
}

const READING_DOMAINS = new Set(["sensor", "binary_sensor"]);

/**
 * The OTHER readings of the device `rep` stands for, shown under its own
 * panel: its group's members, and the registry siblings nobody placed (a
 * pump plug's energy and current). Readings only — a restart button or a
 * network tracker is not something to read — and Home Assistant's hidden and
 * diagnostic entities only when the owner grouped them on purpose.
 */
export function deviceReadings(
  rep: string,
  folding: ReadonlyMap<string, string>,
  entities: Record<string, HassEntity>,
  suppressed: ReadonlySet<string>,
  deviceGroups: readonly DeviceGroup[],
): string[] {
  const chosen = new Set(deviceGroups.find((g) => g.primaryEntityId === rep)?.memberEntityIds ?? []);
  const out: string[] = [];
  for (const [id, to] of folding) {
    if (to !== rep || id === rep || !entities[id]) continue;
    if (!READING_DOMAINS.has(domainOf(id))) continue;
    if (suppressed.has(id) && !chosen.has(id)) continue;
    out.push(id);
  }
  return out.sort();
}

/**
 * Home Assistant entities the villa cannot show ANYWHERE — Advanced
 * Settings' audit. Not one that belongs to a placed device (it is shown, in
 * that device's panel), not one HA hides. (A dismissal applies only to an id
 * Home Assistant no longer knows — dismissedEntitySet — so it can never touch
 * this list, which is built from the entities HA does know.)
 */
export function unshownEntities(input: {
  entities: Record<string, HassEntity>;
  entityMap: Record<string, EntityMapping>;
  folding: ReadonlyMap<string, string>;
  suppressed: ReadonlySet<string>;
  /** A type this app can draw (EntityMap.inferTypeFromEntityId). */
  knownType: (id: string) => boolean;
}): string[] {
  return Object.keys(input.entities)
    .filter((id) => input.knownType(id) && !input.entityMap[id] && !input.suppressed.has(id) && !input.folding.has(id))
    .sort();
}

/** A change to the owner's groups. */
export type GroupEdit =
  | { kind: "create"; primaryEntityId: string; id: string }
  | { kind: "add"; groupId: string; memberEntityId: string }
  | { kind: "accept"; primaryEntityId: string; memberEntityId: string; id: string }
  | { kind: "remove-member"; groupId: string; memberEntityId: string };

/**
 * Apply `edit` to the groups in `c`, or say why not. ONE ENTITY, ONE GROUP is
 * enforced here, against the config the edit is applied to — it lived in the
 * Settings component, checked against the list that render saw, and accepting
 * a suggestion did not check it at all.
 */
export function groupEdit(c: Pick<AppConfig, "deviceGroups">, edit: GroupEdit): Pick<AppConfig, "deviceGroups"> | string {
  const taken = groupedEntityIds(c.deviceGroups);
  const withGroups = (deviceGroups: DeviceGroup[]) => ({ deviceGroups });
  const put = (g: DeviceGroup) => upsertGroup(c as AppConfig, g);
  switch (edit.kind) {
    case "create":
      if (taken.has(edit.primaryEntityId)) return "This entity is already part of another group.";
      return put({ id: edit.id, primaryEntityId: edit.primaryEntityId, memberEntityIds: [] });
    case "add": {
      const g = c.deviceGroups.find((x) => x.id === edit.groupId);
      if (!g) return "That group no longer exists.";
      if (!edit.memberEntityId || edit.memberEntityId === g.primaryEntityId) return withGroups([...c.deviceGroups]);
      if (taken.has(edit.memberEntityId)) return "This entity is already part of a group.";
      return put({ ...g, memberEntityIds: [...g.memberEntityIds, edit.memberEntityId] });
    }
    case "accept": {
      const existing = c.deviceGroups.find((g) => g.primaryEntityId === edit.primaryEntityId);
      if (taken.has(edit.memberEntityId)) return "This entity is already part of a group.";
      if (!existing && taken.has(edit.primaryEntityId)) return "This entity is already part of another group.";
      // A primary's second suggestion ADDS to its group rather than making a
      // second, orphaned group under the same primary.
      return put(existing
        ? { ...existing, memberEntityIds: [...existing.memberEntityIds, edit.memberEntityId] }
        : { id: edit.id, primaryEntityId: edit.primaryEntityId, memberEntityIds: [edit.memberEntityId] });
    }
    case "remove-member": {
      const g = c.deviceGroups.find((x) => x.id === edit.groupId);
      if (!g) return withGroups([...c.deviceGroups]);
      return put({ ...g, memberEntityIds: g.memberEntityIds.filter((id) => id !== edit.memberEntityId) });
    }
  }
}
