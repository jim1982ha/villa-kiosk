// src/config/devicePlace.ts
// WHERE A DEVICE IS: its room and that room's floor, for every screen that names a place
// (architecture review 2026-10-12, candidate 3: the floor; 2026-10-16: the room).
//
// ⚠️ THE ROOM WAS LOOKED UP AND CLEANED BY HAND (2026-10-16). The id set was assembled inside a React
// effect in Dashboard, the rule lived in EntityMap, and about fourteen callers read the result four
// ways: `?.trim() || "Other"`, `?.trim() ?? ""`, `?.trim()` and the raw value. The raw readers met
// resolveRooms's "" for "no room" with `??`, which stops at "": the Overview's attention card (a fault
// on a device standing for its battery sensor) read "Other" although the sensor itself had a room.
// This module now owns, as plain values:
//   • the ids to resolve (roomIdSet) — every entity Home Assistant has, plus the map's and the
//     stored mappings' (with their linked/motion targets);
//   • the rule (resolveEntityRoom/resolveRooms) — Home Assistant's area, else the drawn room the
//     scene says the device sits in (DrawnRoomOf, injected: the scene is Dashboard's adapter);
//   • the clean-up — "" or blank is NO room (cleanRoom/deviceRoom), and roomLabel is the ONE place
//     no room becomes the "Other" label;
//   • the fallback chain — a device's room, else its entity's, else the room a record was stored
//     with (deviceRoomOrRecord), "empty" meaning absent at every step;
//   • a room's floor (below).
// Two other "where" questions are deliberately NOT this module, and must stay apart:
//   • the storey a badge is DRAWN on (babylon/floorOf.ts) — where its 3D object physically sits, or
//     it shows through the slab;
//   • the plan room the walker stands in (babylon/walkerView.ts, storeys.ts) — a camera position,
//     not a device's room; those files say why the two questions must not be merged.
//
// THE floor of a room, for every device list (2026-10-12):
//
// ⚠️ A ROOM'S FLOOR DEPENDED ON THE LIST IT WAS IN. The Cockpit's room tiles (removed 2.496.442) took the HA floor of
// the FIRST device of the room that had one — among the devices of the list being drawn — so the
// Cockpit (every device) and a category's list (2.496.336: Lights, grouped by floor) could file the
// same room on different floors. Each room's floor is now decided once, over EVERY device the Kiosk
// has placed in a room, and every list reads that one answer:
//   1. Home Assistant's Floor (each device's Area's Floor, entityFloorNumbers) — the floor most of
//      the room's devices are on, the lower one on a tie;
//   2. else the floor plan's own room (sh3dRooms, by room name; a plan room with no floor is 1F);
//   3. else none (the "Other" bucket).
// The MAP is not this: a badge is drawn on the storey its 3D object physically sits on
// (babylon/floorOf.ts), and must stay there or it shows through the slab.

import { roomKey, NO_ROOM_LABEL } from "./roomKey";
import type { EntityMapping } from "@/types/scene.types";

// ── The room ────────────────────────────────────────────────────────────────

/** Which drawn room of the floor plan this entity's 3D anchor sits in, or null (outside every room,
 *  or not on the model). Injected: only a browser with the scene loaded can answer it — Dashboard
 *  passes SceneManager.roomForEntity (EntityVisuals.roomForEntity), an oracle passes a table. */
export type DrawnRoomOf = (entityId: string) => string | null;

/**
 * Every entity id as ONE string, sorted — what Dashboard memoises over the live store, so a state
 * push that changes no id yields an equal string and resolves nothing again. (One sort + join per
 * push: what the id set has cost since 2.496.382, and no more.)
 */
export function entityIdsKey(entities: Readonly<Record<string, unknown>>): string {
  return Object.keys(entities).sort().join("\n");
}

/**
 * THE ids that get a room: every entity Home Assistant has (`haIdsKey`, entityIdsKey's string), the
 * model's own (`mapped` — a mesh bound to an entity needs no stored mapping to draw a badge), the
 * stored mappings, and every linked/motion target (only ever a VALUE on another mapping).
 *
 * ⚠️ THE SET USED TO BE THE STORED MAPPINGS (2.496.202): a device the model carries through a mesh
 * binding got no room — "Other", the one bucket the placement pass will not fold into a chip; the
 * owner's TV sat drawn on top of the collapsed "Living Room 18". Then a list (2.496.382, owner
 * 2026-10-15): a fault on a sensor the model does not draw had no room line, so every entity Home
 * Assistant has is in it — not one more source to join each time a new screen names a place.
 */
export function roomIdSet(
  haIdsKey: string,
  mapped: Iterable<string>,
  entityMap: Readonly<Record<string, EntityMapping>>,
): Set<string> {
  // In this order (the order Dashboard always built it in, so resolvedRooms's keys keep theirs).
  const ids = new Set<string>([...mapped, ...Object.keys(entityMap), ...(haIdsKey ? haIdsKey.split("\n") : [])]);
  for (const mapping of Object.values(entityMap)) {
    if (mapping.linkedEntityId) ids.add(mapping.linkedEntityId);
    if (mapping.motionEntityId) ids.add(mapping.motionEntityId);
  }
  return ids;
}

/**
 * THE authoritative rule for "what room is this device in" — Dashboard.tsx's room-resolution effect
 * runs it (resolveRooms) over roomIdSet on every HA registry change and every scene re-calibration,
 * and pushes the result to both React (ConfigContext's resolvedRooms) and Babylon (SceneManager.
 * setResolvedRooms). Room used to be a field on EntityMapping itself, hand-typed in two separate
 * Advanced Settings editors — which meant it could silently disagree with Home Assistant's own Area
 * assignment for the same device, two sources of truth that had no way to reconcile. Now there is
 * exactly one: HA's Area wins whenever the device has one; geometric detection (which drawn room
 * polygon the device's own 3D anchor sits inside) is the fallback for whatever HA hasn't organised
 * into an Area yet. Nothing in the kiosk writes a room any more — see BindingsTable.tsx /
 * EntityMapRow.tsx, which used to. "" = no room (stored as is: RoomShare uploads this table).
 */
export function resolveEntityRoom(
  areaName: string | undefined,
  geometricRoom: string | null,
): string {
  return areaName || geometricRoom || "";
}

/** The room of every id (roomIdSet) by resolveEntityRoom — one pass over one id set. */
export function resolveRooms(
  ids: Iterable<string>,
  areaNames: Record<string, string>,
  drawnRoomOf: DrawnRoomOf,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const id of ids) {
    if (id in resolved) continue;
    // the model is asked only when Home Assistant has no area for it (every entity is asked now, 2026-10-15)
    resolved[id] = resolveEntityRoom(areaNames[id], areaNames[id] ? null : drawnRoomOf(id));
  }
  return resolved;
}

/** A room as a value: trimmed, and "" for none — blank, missing, or the "" resolveRooms stores. */
export function cleanRoom(room: string | null | undefined): string {
  return room?.trim() ?? "";
}

/** THE label of a room on screen: the room, or the no-room bucket ("Other"). The one place no room
 *  becomes that word — the map's grouping, the device lists, the Overview. */
export function roomLabel(room: string | null | undefined): string {
  return cleanRoom(room) || NO_ROOM_LABEL;
}

/** The room of one device/entity ("" = none). Every reader of resolvedRooms asks this. */
export function deviceRoom(rooms: Readonly<Record<string, string | undefined>>, id: string): string {
  return cleanRoom(rooms[id]);
}

/** The room of one device/entity as a label (its room, else "Other"). */
export function deviceRoomLabel(rooms: Readonly<Record<string, string | undefined>>, id: string): string {
  return roomLabel(rooms[id]);
}

/** The first of `rooms` that names a room ("" when none does). EMPTY MEANS ABSENT: `??` would stop at
 *  the "" resolveRooms stores for a device with no room, and never reach the next. */
export function firstRoom(...rooms: (string | null | undefined)[]): string {
  for (const r of rooms) {
    const c = cleanRoom(r);
    if (c) return c;
  }
  return "";
}

/**
 * A problem's room: the room of the DEVICE it is folded under, else of its own entity (a battery
 * sensor in a room while the lock standing for its device has none), else the room the record was
 * stored with (a ticket's or a schedule's). "" when none has one.
 */
export function deviceRoomOrRecord(
  rooms: Readonly<Record<string, string | undefined>>,
  deviceId: string,
  entityId: string | undefined,
  recordRoom: string | undefined,
): string {
  return firstRoom(rooms[deviceId], entityId ? rooms[entityId] : undefined, recordRoom);
}

// ── The floor ───────────────────────────────────────────────────────────────

/**
 * A Home Assistant Floor as a storey number: a leading digit in its NAME first ("1F", "2F" — the
 * convention this app labels every floor with), else its optional `level`. HA's `level` is a
 * user-set integer with no forced meaning: a real villa had "1F" at level 1 but "2F" at level
 * null, so the name is the more reliable signal whenever it has a digit.
 */
export function haFloorNumber(name: string | undefined, level: number | null | undefined): number | null {
  const digits = name?.match(/\d+/);
  if (digits) return Number(digits[0]);
  return level ?? null;
}

/** Every room the Kiosk has placed a device in, mapped to its floor (null = no floor known). */
export function roomFloors(
  resolvedRooms: Readonly<Record<string, string>>,
  sh3dRooms: readonly { name: string; floor?: number }[] | undefined,
  entityFloorNumbers: Readonly<Record<string, number>>,
): Map<string, number | null> {
  const planFloor = new Map<string, number>();
  for (const r of sh3dRooms ?? []) planFloor.set(roomKey(r.name), r.floor ?? 1);
  // room → (HA floor → how many of its devices are on it)
  const votes = new Map<string, Map<number, number>>();
  for (const [id, rawRoom] of Object.entries(resolvedRooms)) {
    const room = roomLabel(rawRoom);
    if (!votes.has(room)) votes.set(room, new Map());
    const f = entityFloorNumbers[id];
    if (f != null) votes.get(room)!.set(f, (votes.get(room)!.get(f) ?? 0) + 1);
  }
  const out = new Map<string, number | null>();
  for (const [room, counts] of votes) {
    if (room === NO_ROOM_LABEL) { out.set(room, null); continue; }
    let best: number | null = null, n = 0;
    for (const [f, c] of counts) if (c > n || (c === n && best !== null && f < best)) { best = f; n = c; }
    out.set(room, best ?? planFloor.get(roomKey(room)) ?? null);
  }
  return out;
}

/** The floor of one room, for a room `roomFloors` did not see (none: "Other"). */
export function floorOfRoom(floors: ReadonlyMap<string, number | null>, room: string): number | null {
  return floors.get(room) ?? null;
}
