// src/config/summaryRows.ts
// WHICH ROWS A DEVICE LIST SHOWS, and in which rooms — the list a SummaryBar
// tile, a room chip, a top-bar category or the Facility views open
// (SummaryGroupPanel), and under which headings (listSections). Pure: tests/oracles/summary_rows.mjs drives it by value.
//
// ⚠️ IT WAS THE PANEL'S BODY (until 2.496.276). The three buckets, the guest's
// off-map rule, the phantom stand-ins and "the list agrees with the count that
// opened it" lived inline in a .tsx, pinned only by a regex on one line; and
// "by room, alphabetical, no-room last" was written twice — here and in the
// Cockpit's room tiles (removed 2.496.442 with the tiles themselves).

import type { HassEntity } from "@/types/ha.types";
import { phantomEntity } from "@/utils/phantomEntity";
import { ROW_SWITCH_DOMAINS } from "@/utils/quickAction";
import { domainOf } from "@/utils/entityDomain";
import { NO_ROOM_LABEL } from "./roomKey";
import { roomLabel } from "./devicePlace";

/** Alphabetical, the no-room bucket ("Other") always last — the one order of
 *  every by-room list. */
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
    const room = roomLabel(roomOf(idOf(t)));
    const list = buckets.get(room) ?? [];
    list.push(t);
    buckets.set(room, list);
  }
  return [...buckets.entries()].sort(([a], [b]) => byRoomOrder(a, b));
}

/**
 * bucketByRoom's rooms, gathered under their floor. Floors ascending; rooms with no floor (null) last, in the order
 * bucketByRoom gave them. `floorOf` answers per ROOM — config/devicePlace's one answer, decided over every device of
 * the villa, so two lists cannot file one room on two floors.
 */
export function bucketByFloor<T>(
  rooms: readonly [string, T[]][], floorOf: (room: string) => number | null,
): [number | null, [string, T[]][]][] {
  const floors = new Map<number | null, [string, T[]][]>();
  for (const r of rooms) {
    const f = floorOf(r[0]);
    const list = floors.get(f) ?? [];
    list.push(r);
    floors.set(f, list);
  }
  return [...floors.entries()].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity));
}

/** How a device list is split: by room (the default) or by floor — the toggle of every device list (owner,
 *  2026-10-20: the Cockpit's Room / Floor / Category tiles moved here, each heading with its own "Turn all on/off"). */
export type Grouping = "room" | "floor";

/** One heading of a device list and the devices under it. */
interface ListSection<T> { key: string; title: string; items: T[] }

/** `items` under their headings: each room (byRoomOrder), or each floor ("1F", "2F" ascending, the no-floor ones
 *  last as NO_ROOM_LABEL) with its devices in their rooms' order. */
export function listSections<T>(
  items: readonly T[], idOf: (t: T) => string, roomOf: (id: string) => string,
  floorOf: (room: string) => number | null, grouping: Grouping,
): ListSection<T>[] {
  const rooms = bucketByRoom(items, idOf, roomOf);
  if (grouping === "room") return rooms.map(([room, members]) => ({ key: `room:${room}`, title: room, items: members }));
  return bucketByFloor(rooms, floorOf).map(([floor, floorRooms]) => ({
    key: `floor:${floor ?? "none"}`,
    title: floor != null ? `${floor}F` : NO_ROOM_LABEL,
    items: floorRooms.flatMap(([, members]) => members),
  }));
}

/** Whether the list offers the Room / Floor toggle: only when it spans more than one room — a room's own list has one
 *  heading either way. */
export function offersGrouping<T>(items: readonly T[], idOf: (t: T) => string, roomOf: (id: string) => string): boolean {
  return bucketByRoom(items, idOf, roomOf).length > 1;
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
  /** What "Turn all on/off" may address: real entities a row has a switch for (ROW_SWITCH_DOMAINS: locks included). */
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
    toggleables: [...onMap, ...offMap].filter((e) => ROW_SWITCH_DOMAINS.has(domainOf(e.entity_id))),
  };
}
