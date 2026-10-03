// src/components/cockpit/cockpitData.ts
// Pure derivation for the Cockpit page — no React, no I/O. Everything here
// routes through selectableDeviceIds/entityMap/resolvedRooms, never a raw HA
// domain query: a real villa has hundreds of `switch`/`select`/`button`
// entities that are internal Zigbee2MQTT device configuration (per-motor
// calibration, relay-lock toggles), not end-user villa state — a domain-count
// summary would be actively misleading, not just noisy. See the Cockpit plan
// memory for how this was verified.

import { stateLabelFor } from "@/config/BinarySensorClasses";
import { categoryMembers, type CategoryMembers } from "@/config/activeDevices";
import { deviceLook, groupLook, type LookSource } from "@/utils/deviceActivity";
import { displayLabelFor } from "@/config/EntityMap";
import { roomKey, NO_ROOM_LABEL } from "@/config/roomKey";
import type { HassEntity, RawLogbookEntry } from "@/types/ha.types";
import type { EntityMapping } from "@/types/scene.types";

/** A category's devices — what its tile counts (tileStats) and opens. */
export type CategoryTile = CategoryMembers;

/** What a Cockpit tile (room, floor or category) counts: its devices, how
 *  many are on — POWER, a group's `onCount` (a locked lock is not "on", a
 *  motion sensor never is) — and how many Home Assistant has lost. */
export interface TileStats { total: number; onCount: number; offline: number }

export function tileStats(entityIds: readonly string[], source: LookSource): TileStats {
  const g = groupLook(entityIds.map((id) => deviceLook(id, source)), { showingDevices: false });
  return { total: entityIds.length, onCount: g.onCount, offline: g.offline };
}

/** The line under a tile's name — ONE wording for rooms, floors and
 *  categories (2.496.235; rooms and floors were bars): "4 devices · 1 on",
 *  plus "· 1 offline" when Home Assistant has lost any of them. */
export function tileLine(s: TileStats): string {
  if (s.total === 0) return "None";
  const parts = [`${s.total} device${s.total === 1 ? "" : "s"}`];
  if (s.onCount > 0) parts.push(`${s.onCount} on`);
  if (s.offline > 0) parts.push(`${s.offline} offline`);
  return parts.join(" · ");
}

/** One tile per category, count + a generic cross-domain "on" count —
 *  deliberately non-judgmental (a light being on isn't a problem), kept
 *  visually separate from the attention list so the page doesn't read as
 *  "everything is red". */
export function buildCategoryTiles(
  selectableIds: readonly string[],
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
): CategoryTile[] {
  return categoryMembers(selectableIds, entities, entityMap);
}


export interface RoomGroup {
  room: string;
  /** null for the "Other" bucket, or a room with no resolvable floor at all
   *  (neither HA nor the floor plan has one for it). */
  floor: number | null;
  count: number;
  /** Every selectable device resolved to this room — lets the Cockpit pivot
   *  row drill into the same SummaryGroupPanel every other device list in
   *  the app already uses, instead of a bespoke list view. */
  entityIds: string[];
}

/** Devices bucketed by resolved room, each joined to its floor. HA's own
 *  Floor assignment wins whenever any device in the room has one (via
 *  entityFloorNumbers — see HAStateStore.tsx); the floor-plan's own per-room
 *  `floor` value (sh3dRooms, matched by room NAME) is the fallback for
 *  whatever HA hasn't organised into a Floor yet — same "HA wins, geometry
 *  is the fallback" precedence resolvedRooms itself already uses. Reported:
 *  a room whose devices' Areas were all correctly on "2F" in HA still fell
 *  into the floor pivot's "Other" bucket, because the floor-plan's OWN
 *  drawn-room data (sh3dRooms) was the only signal ever read for storey —
 *  it either had no entry matching this room's name, or disagreed with a
 *  since-reorganised HA Floor. Alphabetical with "Other" always last, same
 *  convention SummaryGroupPanel's own room grouping uses. */
export function buildRoomGroups(
  selectableIds: readonly string[],
  resolvedRooms: Record<string, string>,
  sh3dRooms: { name: string; floor?: number }[] | undefined,
  entityFloorNumbers: Record<string, number>,
): RoomGroup[] {
  const floorByRoom = new Map<string, number>();
  for (const r of sh3dRooms ?? []) floorByRoom.set(roomKey(r.name), r.floor ?? 1);

  const idsByRoom = new Map<string, string[]>();
  for (const id of selectableIds) {
    const room = resolvedRooms[id]?.trim() || NO_ROOM_LABEL;
    const list = idsByRoom.get(room) ?? [];
    list.push(id);
    idsByRoom.set(room, list);
  }
  return [...idsByRoom.entries()]
    .map(([room, entityIds]) => {
      const haFloor = entityIds.map((id) => entityFloorNumbers[id]).find((f) => f != null);
      const floor = room === NO_ROOM_LABEL ? null : (haFloor ?? floorByRoom.get(roomKey(room)) ?? null);
      return { room, count: entityIds.length, entityIds, floor };
    })
    .sort((a, b) => {
      if (a.room === NO_ROOM_LABEL) return b.room === NO_ROOM_LABEL ? 0 : 1;
      if (b.room === NO_ROOM_LABEL) return -1;
      return a.room.localeCompare(b.room);
    });
}

export interface FloorGroup {
  /** null = rooms with no resolvable floor (including the "Other" bucket). */
  floor: number | null;
  count: number;
  /** Every selectable device on this floor — the union of its rooms'
   *  entityIds, same reasoning as RoomGroup's own field above. */
  entityIds: string[];
}

/** Re-bucket buildRoomGroups' output by floor instead of room — the same
 *  underlying counts, pivoted, so the two views can never disagree with each
 *  other the way two independently-computed totals eventually would. */
export function buildFloorGroups(roomGroups: RoomGroup[]): FloorGroup[] {
  const idsByFloor = new Map<number | null, string[]>();
  for (const g of roomGroups) {
    const list = idsByFloor.get(g.floor) ?? [];
    list.push(...g.entityIds);
    idsByFloor.set(g.floor, list);
  }
  return [...idsByFloor.entries()]
    .map(([floor, entityIds]) => ({ floor, count: entityIds.length, entityIds }))
    .sort((a, b) => (a.floor ?? Infinity) - (b.floor ?? Infinity));
}

export interface ActivityEntry {
  /** epoch ms (RawLogbookEntry.when is epoch SECONDS — converted once here). */
  t: number;
  name: string;
  message: string;
}

/**
 * Turn one raw logbook row into a readable line. Only automation/script
 * entries carry a real HA-authored `message` (the computed trigger cause) —
 * used verbatim, since reproducing THAT is exactly the kind of thing this
 * app has no business re-implementing. A plain state change (a motion
 * sensor, a lock, a light) arrives with just a raw `state` and no sentence —
 * HA's own frontend builds that text client-side, the API doesn't hand it
 * over — so this reuses the kiosk's OWN existing state vocabulary
 * (BinarySensorClasses' on/off wording, the same table SensorPanel/badges
 * already read) rather than showing a bare "on"/"off", or invents nothing
 * and falls back to the raw state, capitalised, for domains with no such
 * table (lock, switch, light, …). Returns null when there's truly nothing
 * to show (no entity_id, no message, no state).
 */
export function describeLogbookEntry(
  raw: RawLogbookEntry,
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
): ActivityEntry | null {
  const t = raw.when * 1000;
  if (!Number.isFinite(t)) return null;

  if (raw.message) {
    return { t, name: raw.name ?? raw.entity_id ?? "", message: raw.message };
  }
  if (!raw.entity_id || raw.state == null) return null;

  const entity = entities[raw.entity_id];
  const mapping = entityMap[raw.entity_id];
  const name = displayLabelFor(raw.entity_id, mapping?.label, raw.name ?? (entity?.attributes.friendly_name as string | undefined));

  // ⚠️ THE SHARED WORDS, NOT ITS OWN (2.496.252). This line worded binary
  // states by hand — anything but "on" took the OFF word, so a leak sensor
  // that went OFFLINE read "No leak" — and capitalised the rest by hand, so
  // "not_home" read "Not_home". stateLabelFor and prettyState are the rules
  // every other surface (the pill, the history bars) already reads.
  return { t, name, message: stateLabelFor(raw.entity_id, entity?.attributes.device_class as string | undefined)(raw.state) };
}

/** Describe + filter to the villa's own selectable devices (HA's raw
 *  logbook is unfiltered and genuinely noisy — a bare date/time helper alone
 *  produced roughly one entry every six seconds in a real pull) + sort
 *  newest first. `limit` bounds the RENDERED list, logged via the caller if
 *  entries are actually dropped — this is a "most recent 20" UI choice, not
 *  a silent data cap. */
export function buildActivityFeed(
  raw: RawLogbookEntry[],
  entities: Record<string, HassEntity>,
  entityMap: Record<string, EntityMapping>,
  selectableIds: readonly string[],
  limit = 20,
): ActivityEntry[] {
  const known = new Set(selectableIds);
  const described = raw
    .filter((r) => r.entity_id && known.has(r.entity_id))
    .map((r) => describeLogbookEntry(r, entities, entityMap))
    .filter((e): e is ActivityEntry => e !== null)
    .sort((a, b) => b.t - a.t);
  return described.slice(0, limit);
}
