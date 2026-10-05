// src/config/summaryRows.ts
// WHICH ROWS A DEVICE LIST SHOWS, and in which rooms — the list a SummaryBar
// tile, a room chip, a Cockpit tile or the Facility views open
// (SummaryGroupPanel). Pure: tests/oracles/summary_rows.mjs drives it by value.
//
// ⚠️ IT WAS THE PANEL'S BODY (until 2.496.276). The three buckets, the guest's
// off-map rule, the phantom stand-ins and "the list agrees with the count that
// opened it" lived inline in a .tsx, pinned only by a regex on one line; and
// "by room, alphabetical, no-room last" was written twice — here and in the
// Cockpit's room tiles (cockpitData.buildRoomGroups).

import type { HassEntity } from "@/types/ha.types";
import { phantomEntity } from "@/utils/phantomEntity";
import { TOGGLEABLE_DOMAINS } from "@/utils/quickAction";
import { domainOf } from "@/utils/entityDomain";
import { NO_ROOM_LABEL } from "./roomKey";

/** Alphabetical, the no-room bucket ("Other") always last — the one order of
 *  every by-room list (the device list, the Cockpit's room tiles). */
export function byRoomOrder(a: string, b: string): number {
  if (a === NO_ROOM_LABEL) return b === NO_ROOM_LABEL ? 0 : 1;
  if (b === NO_ROOM_LABEL) return -1;
  return a.localeCompare(b);
}

/** `items` bucketed by their room (`roomOf`, "" for none → NO_ROOM_LABEL), in
 *  byRoomOrder, each bucket in the items' own order. */
export function bucketByRoom<T>(items: readonly T[], idOf: (t: T) => string, roomOf: (id: string) => string): [string, T[]][] {
  const buckets = new Map<string, T[]>();
  for (const t of items) {
    const room = roomOf(idOf(t))?.trim() || NO_ROOM_LABEL;
    const list = buckets.get(room) ?? [];
    list.push(t);
    buckets.set(room, list);
  }
  return [...buckets.entries()].sort(([a], [b]) => byRoomOrder(a, b));
}

export interface SummaryRows {
  /** In Home Assistant and drawn on the map. */
  onMap: HassEntity[];
  /** In Home Assistant, not on the map — empty for a profile that may not
   *  list unmapped devices (the guest). */
  offMap: HassEntity[];
  /** On the map, but Home Assistant has no such entity: a phantom stand-in
   *  ("unavailable"), never dropped — the map shows it, so the list does. */
  notInHa: HassEntity[];
  /** The three, in that order: what the list draws. */
  rows: HassEntity[];
  /** What "Turn all on/off" may address: real entities of a toggleable domain. */
  toggleables: HassEntity[];
}

/**
 * The rows for a group's ids. Every id the caller counted becomes a row (a
 * missing one as a phantom), so the list agrees with the count that opened it
 * — except what the profile may not see (`mayListUnmapped`) and, when
 * `filterSuppressed`, what HA hides or files as configuration/diagnostic.
 */
export function summaryRows(
  entityIds: readonly string[],
  o: {
    entities: Readonly<Record<string, HassEntity | undefined>>;
    mapped: ReadonlySet<string>;
    suppressed: ReadonlySet<string>;
    filterSuppressed: boolean;
    mayListUnmapped: boolean;
  },
): SummaryRows {
  const all = entityIds
    .filter((id) => !o.filterSuppressed || !o.suppressed.has(id))
    .map((id) => o.entities[id] ?? phantomEntity(id));
  const inHa = (e: HassEntity) => !!o.entities[e.entity_id];
  const notInHa = all.filter((e) => !inHa(e));
  const onMap = all.filter((e) => inHa(e) && o.mapped.has(e.entity_id));
  const offMap = o.mayListUnmapped ? all.filter((e) => inHa(e) && !o.mapped.has(e.entity_id)) : [];
  return {
    onMap, offMap, notInHa,
    rows: [...onMap, ...offMap, ...notInHa],
    toggleables: [...onMap, ...offMap].filter((e) => TOGGLEABLE_DOMAINS.has(domainOf(e.entity_id))),
  };
}
