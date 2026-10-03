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
// A/C), and only for devices a person can switch. A sensor (motion, door,
// temperature), a camera, a weather station is never "on".

import type { HassEntity } from "@/types/ha.types";
import type { Category, EntityMapping } from "@/types/scene.types";
import { CATEGORY_ORDER, effectiveCategory, subjectOf } from "./EntityCategories";
import { domainOf } from "@/utils/entityDomain";

// ⚠️ POWER IS deviceActivity's (2.496.245). `hasOnOff` / `isActive` lived
// here while the badge's ACTIVITY lived there — two meanings of "on" in two
// modules, each summary picking one by which file it happened to import. Both
// meanings are owned by utils/deviceActivity now (isSwitchedOn = POWER,
// DeviceLook.active = ACTIVITY); this module keeps the counting and the bulk
// switch, and counts POWER, by name.


export interface CategoryMembers { category: Category; entityIds: string[] }

/** Per category: which of these devices are in it. Devices without a mapping
 *  are left out (a category comes from the mapping).
 *
 *  ⚠️ IT ALSO COUNTED "ON" (until 2.496.268), with isSwitchedOn — and nothing
 *  read it: the Cockpit tile recounts its devices through tileStats
 *  (groupLook's POWER count, the same rule), so one rule ran twice and only
 *  one answer was ever shown. Counting is the tile's. */
export function categoryMembers(
  ids: readonly string[], entities: Record<string, HassEntity>, entityMap: Record<string, EntityMapping>,
): CategoryMembers[] {
  const members = new Map<Category, string[]>(CATEGORY_ORDER.map((c) => [c, []]));
  for (const id of ids) {
    const mapping = entityMap[id];
    if (!mapping) continue;
    const entity = entities[id];
    const cat = effectiveCategory(subjectOf(id, mapping, entity));
    members.get(cat)?.push(id);
  }
  return CATEGORY_ORDER.map((category) => ({ category, entityIds: members.get(category) ?? [] }));
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
