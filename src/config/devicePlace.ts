// src/config/devicePlace.ts
// THE floor of a room, for every device list (architecture review 2026-10-12, candidate 3).
//
// ⚠️ A ROOM'S FLOOR DEPENDED ON THE LIST IT WAS IN. cockpitData.buildRoomGroups took the HA floor of
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
    const room = rawRoom?.trim() || NO_ROOM_LABEL;
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
