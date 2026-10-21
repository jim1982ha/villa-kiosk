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

import { domainOf } from "@/utils/entityDomain";
import { countOf } from "@/utils/countOf";

// ⚠️ POWER IS deviceActivity's (2.496.245). `hasOnOff` / `isActive` lived
// here while the badge's ACTIVITY lived there — two meanings of "on" in two
// modules, each summary picking one by which file it happened to import. Both
// meanings are owned by utils/deviceActivity now (isSwitchedOn = POWER,
// DeviceLook.active = ACTIVITY); this module keeps the counting and the bulk
// switch, and counts POWER, by name.


/** One service call of a bulk switch. */
export interface BulkCall { domain: string; service: "turn_on" | "turn_off" | "lock" | "unlock"; entityIds: string[] }

/**
 * Switch a mixed list all on or all off: ONE call PER DOMAIN, each with its
 * own ids — `light.turn_off` for the lights, `switch.turn_off` for the
 * switches; a lock is "on" while unlocked, so turning on UNLOCKS and off LOCKS. Only the domains asked are included.
 */
export function bulkSwitchPlan(entityIds: readonly string[], turnOn: boolean, domains: ReadonlySet<string>): BulkCall[] {
  const byDomain = new Map<string, string[]>();
  for (const id of entityIds) {
    const d = domainOf(id);
    if (!domains.has(d)) continue;
    byDomain.set(d, [...(byDomain.get(d) ?? []), id]);
  }
  return [...byDomain].map(([domain, ids]) => ({
    domain,
    service: domain === "lock" ? (turnOn ? "unlock" : "lock") : (turnOn ? "turn_on" : "turn_off"),
    entityIds: ids,
  }));
}

/** What a bulk switch is about to do, in words (owner, 2026-10-20: the button said "Turn all off" over a list of
 *  temperatures and curtains it never touches): the devices it switches, counted by kind — "Turn off 1 fan",
 *  "Turn on 4 lights and 2 fans", "Lock 1 lock", "Turn off 2 lights and lock 1 lock". `ids`: exactly the ones it
 *  will switch, in a domain this names. */
const KIND: Readonly<Record<string, [string, string]>> = {
  light: ["light", "lights"], fan: ["fan", "fans"], switch: ["switch", "switches"], input_boolean: ["switch", "switches"],
  lock: ["lock", "locks"],
};
export function bulkWords(ids: readonly string[], turnOn: boolean): string {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const kind = KIND[domainOf(id)];
    if (!kind) continue;
    counts.set(kind[0], (counts.get(kind[0]) ?? 0) + 1);
  }
  const said = (one: string) => {
    const n = counts.get(one)!;
    const many = Object.values(KIND).find(([o]) => o === one)![1];
    return countOf(n, one, many);
  };
  const and = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]);
  const switched = [...counts.keys()].filter((k) => k !== "lock").map(said);
  const phrases = [
    ...(switched.length ? [`turn ${turnOn ? "on" : "off"} ${and(switched)}`] : []),
    ...(counts.has("lock") ? [`${turnOn ? "unlock" : "lock"} ${said("lock")}`] : []),
  ];
  const text = phrases.length ? phrases.join(" and ") : `turn ${turnOn ? "on" : "off"} nothing`;
  return text[0].toUpperCase() + text.slice(1);
}
