// src/config/activeDevices.ts
// "Is this device active" and "how many are on" — ONE rule for the Cockpit's
// category tiles and the device lists' "Turn all off/on" (2.496.229).
//
// ⚠️ THE COCKPIT COUNTED ANYTHING NOT "off" AS ON. Its tiles used the generic
// `!OFF_STATES.has(state)`, so a LOCKED lock, a CLOSED blind and a
// temperature sensor reading "24" all counted — the Access tile read "2 on"
// while the bottom bar said "Locked". And "Turn all off" sent the FIRST row's
// domain to every row (a light command to a switch).
//
// Active is devicePower's own answer (the position a power switch would
// show: an unlocked lock, an open blind, a playing media player, a heating
// A/C), and only for devices that HAVE an on/off at all. A sensor, a camera,
// a weather station is never "on".

import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping } from "@/types/scene.types";
import { devicePower } from "@/utils/devicePower";
import { CATEGORY_ORDER, effectiveCategory, subjectOf } from "./EntityCategories";

/** Domains with an on/off a person reads as "on": power switches, locks
 *  (unlocked), covers (open), climate (running), binary sensors (detecting). */
const ON_OFF_DOMAINS: ReadonlySet<string> = new Set([
  "light", "switch", "fan", "input_boolean", "media_player", "lock", "cover", "climate", "binary_sensor",
]);

const domainOf = (id: string) => id.split(".")[0];

/** Whether this device has an on/off at all. */
export function hasOnOff(entityId: string): boolean {
  return ON_OFF_DOMAINS.has(domainOf(entityId));
}

/** Whether this device is on (active) right now. Unknown or unavailable is
 *  not on; a device without an on/off is never on. */
export function isActive(entity: HassEntity | undefined, entityId: string): boolean {
  return hasOnOff(entityId) && devicePower(entity, entityId).position === "on";
}

export interface CategoryCount { category: Category; total: number; onCount: number; entityIds: string[] }

/** Per category: how many of these devices, and how many are on. Devices
 *  without a mapping are not counted (a category comes from the mapping). */
export function categoryCounts(
  ids: readonly string[], entities: Record<string, HassEntity>, entityMap: Record<string, EntityMapping>,
): CategoryCount[] {
  const members = new Map<Category, string[]>(CATEGORY_ORDER.map((c) => [c, []]));
  const ons = new Map<Category, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  for (const id of ids) {
    const mapping = entityMap[id];
    if (!mapping) continue;
    const entity = entities[id];
    const cat = effectiveCategory(subjectOf(id, mapping, entity));
    members.get(cat)?.push(id);
    if (isActive(entity, id)) ons.set(cat, (ons.get(cat) ?? 0) + 1);
  }
  return CATEGORY_ORDER.map((category) => {
    const entityIds = members.get(category) ?? [];
    return { category, total: entityIds.length, onCount: ons.get(category) ?? 0, entityIds };
  });
}

/** One service call of a bulk switch. */
export interface BulkCall { domain: string; service: "turn_on" | "turn_off"; entityIds: string[] }

/**
 * Switch a mixed list all on or all off: ONE call PER DOMAIN, each with its
 * own ids — `light.turn_off` for the lights, `switch.turn_off` for the
 * switches. Only domains with a plain turn_on/turn_off are included.
 */
export function bulkSwitchPlan(entityIds: readonly string[], turnOn: boolean, domains: ReadonlySet<string>): BulkCall[] {
  const byDomain = new Map<string, string[]>();
  for (const id of entityIds) {
    const d = domainOf(id);
    if (!domains.has(d)) continue;
    byDomain.set(d, [...(byDomain.get(d) ?? []), id]);
  }
  return [...byDomain].map(([domain, ids]) => ({ domain, service: turnOn ? "turn_on" : "turn_off", entityIds: ids }));
}
