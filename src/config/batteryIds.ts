// src/config/batteryIds.ts
// Which entities are batteries (device_class "battery"): one set that changes only when that list does, so the
// device parts built on it (devicePartsOf) and the map's marks stay the same objects across state pushes.
//
// ⚠️ IT SCANNED EVERY ENTITY ON EVERY PUSH, in each of the nine hooks that read it (2026-11-21). Now, when the store
// says which ids a push set (entityStore.pushedChange) over the entities seen last, only those are looked at again;
// otherwise every entity's object is compared with the last one's (a changed object only is read), and a full scan
// is made the first time and whenever an entity is added or removed. Comparing alone saved nothing measurable at the
// villa's 1,500 entities: walking the ids was the cost, which the store's list avoids.
// tests/oracles/battery_ids.mjs checks it against a full scan through adds, removes, battery changes and churn.
//
// PURE: no React. VillaModel keeps one tracker per hook.

import type { HassEntity } from "@/types/ha.types";

type Entities = Readonly<Record<string, HassEntity | undefined>>;

const isBattery = (e: HassEntity | undefined) => e?.attributes?.device_class === "battery";

/** The battery set by a full scan: what the tracker must always equal. */
export function batteryIdsOf(entities: Entities): Set<string> {
  const out = new Set<string>();
  for (const id in entities) if (isBattery(entities[id])) out.add(id);
  return out;
}

/** What a push changed (entityStore.PushedChange): the entities it was laid over, and the ids it set. */
export interface Change { from: Entities; ids: readonly string[] }

/** A function from the entities (and, when known, the push that made them) to their battery set, returning the SAME
 *  set while its members are unchanged. */
export function batteryTracker(): (entities: Entities, change?: Change) => ReadonlySet<string> {
  let prev: Entities | null = null;
  let prevCount = 0;
  let set: Set<string> = new Set();
  return (entities, change) => {
    if (entities === prev) return set;
    const last = prev;
    prev = entities;
    let count = 0;
    let next: Set<string> | null = null;
    let full = last === null;
    if (!full && change && change.from === last) {
      // a push over what was seen last: only the ids it set can have changed, and it removes none
      for (const id of change.ids) {
        if (!(id in last!)) { full = true; break; }
        const e = entities[id];
        if (isBattery(e) !== set.has(id)) {
          next ??= new Set(set);
          if (isBattery(e)) next.add(id); else next.delete(id);
        }
      }
      if (!full) {
        if (next) set = next;
        return set;
      }
    } else if (!full) {
      for (const id in entities) {
        count++;
        const e = entities[id];
        if (e === last![id]) continue;
        if (!(id in last!)) { full = true; break; }
        if (isBattery(e) !== set.has(id)) {
          next ??= new Set(set);
          if (isBattery(e)) next.add(id); else next.delete(id);
        }
      }
      if (!full && count !== prevCount) full = true;   // the same ids, fewer of them: one was removed
    }
    if (full) {
      const scanned = batteryIdsOf(entities);
      prevCount = Object.keys(entities).length;
      if (scanned.size !== set.size || [...scanned].some((id) => !set.has(id))) set = scanned;
      return set;
    }
    if (next) set = next;
    return set;
  };
}
