// src/babylon/roomChips.ts
// Room chips — the label a crowded room collapses into — before they are
// measured and drawn: which badges each chip stands for, and what two chips
// become when they merge.
//
// ⚠️ THE FIRST SLICE OF THE TIER RESOLUTION (round-2 candidate 9), AND ONLY
// THAT. Bucketing and the merge's combine rule were inline in
// EntityVisuals.deriveChips, and chip_merge.mjs tested the real merge LOOP
// (boxMerge) with its OWN copy of the combine rule — so the rule that decides
// a merged chip's members, centre, room names and ring was never the one under
// test. The rest of the tiers (cards, escalation, the settle fixpoint) remain
// in EntityVisuals.
// Pure; tests/oracles/room_chips.mjs.

import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * One room chip as DERIVED — everything needed to decide where it lands and
 * what it swallows, before a single GUI control is touched.
 *
 * Lifted out of `updateClusters` when that method split into `deriveChips`
 * (pure) and `renderChips`: CHIP_COLLISION has to re-derive the chips several
 * times in one pass, and a function that also writes to the GUI cannot be run
 * in a loop.
 */
export interface RoomChip {
  /** roomKey() — identity, and the key its GUI controls live under. */
  key: string;
  /**
   * EVERY roomKey this chip stands for, its own included, growing as it merges.
   * `key` alone was enough while nothing outside the merge loop asked what a
   * chip covered; the collision pass does, and `roomNames` cannot answer it —
   * those are printable spellings, and roomKey() exists precisely because a
   * printable spelling is not an identity.
   */
  keys: string[];
  /** The raw name this chip stands for — the identity a person reads and the
   *  modal title. NOT necessarily what is drawn: see `label`. */
  room: string;
  /**
   * The string actually PRINTED, i.e. `room` (+ any "+N") after truncation to
   * the viewport budget. Set by `measure` so the width the merge test reserves
   * and the width `renderChips` paints are the same string through the same
   * estimator — reserving one width and painting another is this subsystem's
   * oldest rule broken.
   */
  label: string;
  ids: string[]; centre: Vector3; rooms: number; roomNames: string[];
  ringRed: boolean; unavailable: boolean;
  /** True-perspective screen position and half-extents — the merge test only.
   *  The collision test re-projects `centre` onto the view plane instead; see
   *  CHIP_COLLISION for why the two spaces are not the same one. */
  x: number; y: number; halfW: number; halfH: number;
}
/** A merged chip says so with "+N", so the count pill's total is never
 *  mistaken for one room's device count. */
/** The "+N" a chip carries when it has swallowed other rooms, or "" when it
 *  names exactly one. Kept SEPARATE from the room name because fitChipLabel
 *  must never truncate it — see that function. */
export const chipSuffixOf = (c: RoomChip) => (c.rooms > 1 ? `+${c.rooms - 1}` : "");

/** One shown badge, as a chip needs it. `kind` is its badge state (on, alert,
 *  unavailable, …) — see EntityVisuals.badgeKind. */
export interface ChipMember {
  id: string;
  /** roomKey() of the room it is in. */
  room: string;
  pos: { x: number; y: number; z: number };
  kind?: string;
}

/**
 * One chip per CLUSTERED room, in first-seen order, unmeasured. A chip's centre
 * is its members' mean position; its ring is red if any member is on or
 * alerting; it is marked unavailable if any member is.
 */
export function bucketRoomChips(
  members: readonly ChipMember[],
  clustered: (roomKey: string) => boolean,
  display: (roomKey: string) => string,
): RoomChip[] {
  const groups = new Map<string, { ids: string[]; sum: Vector3; ringRed: boolean; unavailable: boolean }>();
  for (const m of members) {
    if (!clustered(m.room)) continue;
    let g = groups.get(m.room);
    if (!g) { g = { ids: [], sum: Vector3.Zero(), ringRed: false, unavailable: false }; groups.set(m.room, g); }
    g.ids.push(m.id);
    g.sum.addInPlaceFromFloats(m.pos.x, m.pos.y, m.pos.z);
    // Same rule as the individual badge ring (BADGE_RING): "on" and "alert"
    // both ring red, "unavailable" does not — dimming is that kind's own
    // signal, not a ring (see BADGE_RING's comment).
    if (m.kind === "on" || m.kind === "alert") g.ringRed = true;
    if (m.kind === "unavailable") g.unavailable = true;
  }
  const chips: RoomChip[] = [];
  for (const [key, g] of groups) {
    // Back to the raw spelling for anything a person reads or taps: the key
    // is a Map key only, and `display` holds what to print.
    const room = display(key);
    chips.push({
      key, keys: [key], room, label: room, ids: g.ids.slice(),
      centre: g.sum.scale(1 / g.ids.length), rooms: 1, roomNames: [room],
      ringRed: g.ringRed, unavailable: g.unavailable,
      x: 0, y: 0, halfW: 0, halfH: 0,
    });
  }
  return chips;
}

/**
 * What `keep` becomes when `drop` merges into it: the members of both, a
 * centre weighted by member count (so a chip of eight is not dragged halfway
 * to a chip of one), every room key and name, and either one's ring or
 * unavailable flag. Measuring the result is the caller's (it needs the text
 * metrics and the projection).
 */
export function combineChips(keep: RoomChip, drop: RoomChip): void {
  const na = keep.ids.length, nb = drop.ids.length;
  keep.centre = keep.centre.scale(na / (na + nb)).addInPlace(drop.centre.scale(nb / (na + nb)));
  keep.ids = keep.ids.concat(drop.ids);
  keep.rooms = keep.rooms + drop.rooms;
  // Keep the NAMES, not just the count: a merged chip has to be able to
  // offer the rooms it swallowed when it is tapped, and "+2" cannot.
  keep.roomNames = [...keep.roomNames, ...drop.roomNames];
  keep.keys = [...keep.keys, ...drop.keys];
  keep.ringRed = keep.ringRed || drop.ringRed;
  keep.unavailable = keep.unavailable || drop.unavailable;
}
