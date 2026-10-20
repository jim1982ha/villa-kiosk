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


interface CategoryMembers { category: Category; entityIds: string[] }

/** Per category: which of these devices are in it. Devices without a mapping
 *  are left out (a category comes from the mapping).
 *
 *  It counts nothing: "on" is groupLook's POWER count, asked by whoever draws
 *  the devices (until 2.496.268 it also counted, a second copy of that rule). */
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

/** What a bulk switch is about to do, in words (owner, 2026-10-20: the button said "Turn all off" over a list of
 *  temperatures and curtains it never touches): the devices it switches, counted by kind — "Turn off 1 fan",
 *  "Turn on 4 lights and 2 fans". `ids`: exactly the ones it will switch (the plan's), in a domain this names. */
const KIND: Readonly<Record<string, [string, string]>> = {
  light: ["light", "lights"], fan: ["fan", "fans"], switch: ["switch", "switches"], input_boolean: ["switch", "switches"],
};
export function bulkWords(ids: readonly string[], turnOn: boolean): string {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const kind = KIND[domainOf(id)];
    if (!kind) continue;
    counts.set(kind[0], (counts.get(kind[0]) ?? 0) + 1);
  }
  const parts = [...counts].map(([one, n]) => {
    const many = Object.values(KIND).find(([o]) => o === one)![1];
    return `${n} ${n === 1 ? one : many}`;
  });
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "nothing";
  return `Turn ${turnOn ? "on" : "off"} ${list}`;
}
