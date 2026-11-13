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
import { groupLook, type DeviceLook } from "@/utils/deviceActivity";

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
   *  modal title. What is drawn is `lines`. */
  room: string;
  /**
   * What the chip PRINTS: one line per room it stands for, each with that
   * room's own name, count and health — a merged chip lists its rooms rather
   * than "Living Room +4" beside one total (owner, 2026-11-14). In
   * `orderLines` order. One line for an unmerged chip.
   */
  lines: ChipLine[];
  ids: string[]; centre: Vector3; rooms: number; roomNames: string[];
  /** red: a member needs attention; on: a member is on (and none needs attention) — never red for "on".
   *  deviceActivity.groupLook's count rule; combineChips ORs them on a merge. */
  ringRed: boolean; ringOn: boolean; unavailable: boolean;
  /** A member has an open Cockpit fault (groupLook.fault): the count is amber unless it is red. */
  fault: boolean;
  /** A member is on, even when one needs attention (groupLook.anyOn). */
  anyOn: boolean;
  /** True-perspective screen position and half-extents — the merge test only.
   *  The collision test re-projects `centre` onto the view plane instead; see
   *  CHIP_COLLISION for why the two spaces are not the same one. */
  x: number; y: number; halfW: number; halfH: number;
  /**
   * How far the DRAWN box is moved from where its anchor puts it (true
   * perspective, render px): only so far as keeps the chip inside the map's
   * visible area and off every drawn badge and card (chipPlace.placeChip).
   * 0, 0 for a chip that fits where it stands. Render set only.
   */
  dx: number; dy: number;
  /**
   * How the lines are laid out: `cols` columns of up to `rows` lines, each
   * column filling top-down (chipPlace.chipGrid). 1 × n until a chip is taller
   * than the visible map.
   */
  cols: number; rows: number;
}

/** A chip's DRAWN box, true perspective: entirely above its anchor (renderChips
 *  lifts it by half its own height), moved by its placement. The ONE box the
 *  merge, the placement and placementCheck's counters read. */
export function chipBox(c: RoomChip): { cx: number; cy: number; hw: number; hh: number } {
  return { cx: c.x + c.dx, cy: c.y - c.halfH + c.dy, hw: c.halfW, hh: c.halfH };
}

/** Where line `i` of a chip laid out `rows` lines per column sits: columns
 *  fill top-down, left to right (chipPlace.chipGrid). renderChips places each
 *  line's name, pill and tap zone in this cell. */
export function chipLineCell(i: number, rows: number): { col: number; row: number } {
  return { col: Math.floor(i / rows), row: i % rows };
}

/** The line of a drawn chip under a screen point (true perspective), or -1 off
 *  the chip or on the empty end of its last column — the room a tap there
 *  names, as the tap zones renderChips lays out in the same cells answer it. */
export function chipLineAt(c: RoomChip, x: number, y: number): number {
  const b = chipBox(c);
  const left = b.cx - b.hw, top = b.cy - b.hh;
  if (!(x >= left && x < left + 2 * b.hw && y >= top && y < top + 2 * b.hh)) return -1;
  const col = Math.floor((x - left) / ((2 * b.hw) / c.cols));
  const row = Math.floor((y - top) / ((2 * b.hh) / c.rows));
  const i = col * c.rows + row;
  return i < c.lines.length ? i : -1;
}

/**
 * One room's line in a chip: its name, its own devices and what its own chip
 * would ring — so a merged chip's line shows exactly the count and pill colour
 * that room's chip shows when it stands alone (summaryLook.roomChipModel).
 */
export interface ChipLine {
  /** roomKey() of the room. */
  key: string;
  /** The raw spelling. */
  room: string;
  /**
   * The string actually PRINTED: `room` after truncation to the viewport
   * budget (labelLayout.fitChipLabel), each line on its own. Set by the
   * caller's `measure`, so the width the merge test reserves and the width
   * `renderChips` paints are the same string through the same estimator —
   * reserving one width and painting another is this subsystem's oldest rule
   * broken.
   */
  label: string;
  ids: string[];
  /** This room's own groupLook count rule — summaryLook.roomHealth reads them. */
  ringRed: boolean; fault: boolean; unavailable: boolean;
}

/**
 * A merged chip's lines, busiest room first (most devices), then by room key.
 *
 * ⚠️ NOT SCREEN POSITION, AND NOT MERGE ORDER: both follow the camera, so the
 * lines would reshuffle while the map turns. A room's device count does not
 * move with the camera, and the busiest room is the one the old "+N" label
 * named first. The key is only the tie-break, so two callers holding the same
 * rooms print the same chip (boxMerge's order-independence rule).
 */
export function orderLines(lines: ChipLine[]): ChipLine[] {
  return lines.sort((a, b) => b.ids.length - a.ids.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** One shown badge, as a chip needs it. `look` is its deviceLook
 *  (utils/deviceActivity); undefined while Home Assistant has not reported it
 *  to the map — it then rings nothing. */
export interface ChipMember {
  id: string;
  /** roomKey() of the room it is in. */
  room: string;
  pos: { x: number; y: number; z: number };
  look?: DeviceLook;
}

/**
 * One chip per CLUSTERED room, in first-seen order, unmeasured. A chip's centre
 * is its members' mean position; its ring is deviceActivity.groupLook's COUNT
 * rule (a chip draws no devices): red if any member is alerting (needs
 * attention), the neutral "on" ring if any member is on, none otherwise; it is
 * marked unavailable if any member is.
 */
export function bucketRoomChips(
  members: readonly ChipMember[],
  clustered: (roomKey: string) => boolean,
  display: (roomKey: string) => string,
): RoomChip[] {
  const groups = new Map<string, { ids: string[]; sum: Vector3; looks: (DeviceLook | undefined)[] }>();
  for (const m of members) {
    if (!clustered(m.room)) continue;
    let g = groups.get(m.room);
    if (!g) { g = { ids: [], sum: Vector3.Zero(), looks: [] }; groups.set(m.room, g); }
    g.ids.push(m.id);
    g.sum.addInPlaceFromFloats(m.pos.x, m.pos.y, m.pos.z);
    g.looks.push(m.look);
  }
  const chips: RoomChip[] = [];
  for (const [key, g] of groups) {
    // Back to the raw spelling for anything a person reads or taps: the key
    // is a Map key only, and `display` holds what to print.
    const room = display(key);
    const look = groupLook(g.looks, { showingDevices: false });
    chips.push({
      key, keys: [key], room, ids: g.ids.slice(),
      lines: [{ key, room, label: room, ids: g.ids.slice(), ringRed: look.ringRed, fault: look.fault, unavailable: look.unavailable }],
      centre: g.sum.scale(1 / g.ids.length), rooms: 1, roomNames: [room],
      ringRed: look.ringRed, ringOn: look.ringOn, unavailable: look.unavailable, fault: look.fault, anyOn: look.anyOn,
      x: 0, y: 0, halfW: 0, halfH: 0, dx: 0, dy: 0, cols: 1, rows: 1,
    });
  }
  return chips;
}

/* ⚠️ `ringsSummary`, `summaryRingRed`, `summaryRingOn` AND `RingMember` ARE
   GONE (2.496.245) — the summary ring rule is deviceActivity.groupLook's, with
   both meanings (SHOWING ITS DEVICES / DRAWING A COUNT) and their reasons, and
   it is the one every summary on the map and in the app asks. A group card's
   is read through babylon/summaryLook.groupCardModel. */

/**
 * What `keep` becomes when `drop` merges into it: the members of both, a
 * centre weighted by member count (so a chip of eight is not dragged halfway
 * to a chip of one), every room key, name and line, and either one's ring or
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
  // Each room keeps its own line — its count and health are its own, not the
  // merged chip's (the chip's frame below is the merged one).
  keep.lines = orderLines([...keep.lines, ...drop.lines]);
  keep.ringRed = keep.ringRed || drop.ringRed;
  keep.ringOn = (keep.ringOn || drop.ringOn) && !keep.ringRed;
  keep.unavailable = keep.unavailable || drop.unavailable;
  keep.fault = keep.fault || drop.fault;
  keep.anyOn = keep.anyOn || drop.anyOn;
}
