// src/babylon/storeys.ts
// THE VILLA PLAN: which storey a room, a height or a point is on, which room
// a point is in, which rooms are the ground floor and which are stairwells —
// asked of ONE object, built once per calibration by SceneManager and handed
// to every reader (the camera, the room highlight, the badges, the pools).
//
// ⚠️ FIVE HOLDERS OF THE SAME POLYGONS ANSWERED THOSE QUESTIONS FIVE WAYS
// (2.496.88): two built their own Storeys, two ran the nearest-floor rule on
// their own copy, and two — the stair-foot search and the ceiling coverage
// report — still used "the lowest floor plus 0.30 m is the ground", the height
// rule this module exists to retire. The stairwell test was a regex private to
// SceneManager. All of it is here now.
//
// ⚠️ THE PLAN KNOWS, AND WE THREW IT AWAY. Every room in the plan carries its
// storey as a number; SceneManager dropped it while building the outlines, and
// every consumer re-derived "which storey" from HEIGHTS — each with its own
// threshold. A room's height is one ray at its outline's centre, and a
// staircase's centre is a tread: on the villa GLB the ground-floor staircase
// measures 0.85 m, the upper one 1.11 m, the upstairs terrace 2.21 m. So:
//   * "same storey" was within 0.6 m and "next storey" was 2 m and a vote —
//     a room 0.6–2 m up was on neither; 2.496.79 cut every ground-floor bulb
//     off at the staircase's tread, 2.496.80 patched that one caller;
//   * "the storey of a point" was the highest room floor 0.3 m below it — the
//     staircase's 0.85 for a ceiling lamp at 2.3 — and then only rooms within
//     0.6 m of 0.85 counted: every real ground-floor room was excluded, and a
//     ceiling lamp resolved to no room at all.
//
// Now: a room is on the storey the plan says. A storey's floor is the height
// most of its rooms share, never one odd room. Heights decide only
// where the plan cannot: a room list with no storey numbers is grouped by
// height, a new storey starting at least STOREY_MIN_HEIGHT_M above the last.
//
// Pure: tests/oracles/storeys.mjs drives it with the villa's measured rooms.

import { pointInPolygon, type Pt2 } from "@/utils/geometry";

/**
 * How far a floor must sit BELOW a world point to be the storey that point
 * belongs to. A CLEARANCE, not an epsilon — and the sign is the entire fix
 * (2.435.0).
 *
 * ⚠️ v2.434.0 had this as a +0.05 tolerance: a floor at or *just above* the
 * point still counted. That reads as cautious and is exactly backwards, because
 * of where light fixtures actually live. A ground-floor ceiling lamp hangs
 * within centimetres of the slab above it — 2.60 m under a slab at 2.56 — so
 * the tolerance handed it to the UPPER storey. It then shared the floor probe's
 * cache bucket (`room|round(y)`, and both round to 3) with a genuine upstairs
 * fixture, inherited that room's floor height, and its pool was drawn at 2.58 m
 * — a disc of light hanging at ceiling height instead of lying on the floor
 * two and a half metres below. Reported as exactly that: "the light disk is
 * floating in the air".
 *
 * Flipping the sign separates the two cases by the thing that really tells them
 * apart: **a lamp is mounted a usable distance above the floor it lights.** A
 * ceiling lamp is ~0.04 m below its slab (fails the test, falls through to the
 * floor it actually lights); a table or floor lamp upstairs is 0.3–1.5 m above
 * its own (passes). 0.30 m sits an order of magnitude from both.
 *
 * ⚠️ THE RESIDUAL, stated because a pin would otherwise imply there is none: a
 * fixture recessed INTO an upper floor and pointing up (a floor uplight less
 * than 0.30 m above its own slab) still reads as belonging to the storey below.
 * That case fails quietly — its pool lands on the floor beneath — and it cannot
 * be fixed by a number, because height alone genuinely cannot separate it from
 * a ceiling lamp hanging at the same Y. Only a ray can, and a ray per fixture is
 * what the memo exists to avoid.
 */
export const STOREY_MIN_MOUNT = 0.30;

/** A plan room that is a staircase, by the name the plan gives it. Its
 *  measured floor is a TREAD (0.85 m and 1.11 m on the villa GLB), so it is
 *  never a place to stand or land. */
const STAIR_ROOM_RE = /stair|escalier|escalera|scala|treppe|stufe|trap\b|steps?\b/i;
export function isStairwell(name: string): boolean { return STAIR_ROOM_RE.test(name); }

/** A room as the storeys need it. `storey` is the plan's number for it —
 *  absent when the room list has none. */
export interface StoreyRoomIn { name: string; pts: Pt2[]; floorY: number; storey?: number }

/** How far above one storey's floor the next one's must be, when there are
 *  no storey numbers to go by — a storey is a ceiling height, and a
 *  staircase's tread or a raised terrace is not one. */
export const STOREY_MIN_HEIGHT_M = 2.0;
/** A point this close above a room's floor still stands in it (a slab's own
 *  thickness, a probe's rounding). */
const FLOOR_SLACK_M = 0.05;

export class Storeys<R extends StoreyRoomIn = StoreyRoomIn> {
  readonly rooms: readonly R[];
  /** Storey keys, lowest canonical floor first. */
  private readonly order: number[];
  private readonly floor = new Map<number, number>();
  private readonly of = new Map<R, number>();
  /** Each room's ceiling: the floor of the storey above its own (Infinity at
   *  the top). Nothing standing at or above it is IN that room. */
  private readonly ceiling = new Map<R, number>();

  constructor(rooms: readonly R[]) {
    this.rooms = rooms;
    const numbered = new Set(rooms.map((r) => r.storey).filter((s): s is number => s !== undefined));
    // Two or more numbers: the plan's word. One number (a config that never
    // set storeys defaults every room to 1) or none: heights, below.
    if (numbered.size >= 2) {
      for (const r of rooms) this.of.set(r, r.storey ?? Math.min(...numbered));
    } else {
      // No usable numbers: group by height. Sorted, a storey starts at the
      // first floor at least STOREY_MIN_HEIGHT_M above the current one's start.
      const sorted = [...rooms].sort((a, b) => a.floorY - b.floorY);
      let key = 0, start = -Infinity;
      for (const r of sorted) {
        if (r.floorY >= start + STOREY_MIN_HEIGHT_M) { key++; start = r.floorY; }
        this.of.set(r, key);
      }
    }
    const members = new Map<number, number[]>();
    for (const [r, s] of this.of) members.set(s, [...(members.get(s) ?? []), r.floorY]);
    // The height most of the storey's rooms share (0.1 m buckets; a tie goes
    // to the lower), and that bucket's lowest real floor — not a median, which
    // for 2.56, 2.56, 2.21, 1.11 is the terrace.
    for (const [s, ys] of members) {
      const counts = new Map<number, number>();
      for (const y of ys) { const k = Math.round(y * 10); counts.set(k, (counts.get(k) ?? 0) + 1); }
      let best = 0, n = 0;
      for (const [k, c] of counts) if (c > n || (c === n && k < best)) { best = k; n = c; }
      this.floor.set(s, Math.min(...ys.filter((y) => Math.round(y * 10) === best)));
    }
    this.order = [...this.floor.keys()].sort((a, b) => this.floor.get(a)! - this.floor.get(b)!);
    for (const [r, s] of this.of) this.ceiling.set(r, this.floorAbove(s));
  }

  /**
   * Whether a floor at `y` is under the storey above `room` rather than in it.
   * ⚠️ ROOM OUTLINES ARE FLAT AND THE STOREYS' LIE OVER EACH OTHER (2.496.139).
   * Standing upstairs where the plan draws no upstairs room — a balcony, a
   * landing added by hand — the only outline containing the point was the
   * ground-floor room beneath it, and "nearest floor of the rooms containing
   * it" named that room: an upstairs lamp's pool was clipped to the living
   * room's outline and its glow cut off at a ceiling BELOW the lamp, and the
   * walk-in banner named the room one floor down. The next storey's floor is
   * a slab between the two, so a room is never the answer from above it.
   */
  private aboveCeiling(room: R, y: number): boolean {
    return y >= (this.ceiling.get(room) ?? Infinity) - FLOOR_SLACK_M;
  }

  /** How many storeys there are. */
  get count(): number { return this.order.length; }

  /** The storey a room is on. */
  storeyOf(room: R): number | null { return this.of.get(room) ?? null; }

  /** A storey's floor: the height its rooms agree on. */
  floorOf(storey: number): number { return this.floor.get(storey) ?? 0; }

  /**
   * The storey of a point an UNKNOWN height above its floor — a light
   * fixture, a device's anchor. Clearance, on the storeys' OWN floors: the
   * highest storey whose floor is at least STOREY_MIN_MOUNT below it, else the
   * lowest. A ceiling lamp hangs centimetres under the slab above; the
   * clearance is what keeps it on the storey it lights.
   */
  storeyAt(y: number): number | null {
    if (this.order.length === 0) return null;
    let pick = this.order[0];
    for (const s of this.order) if (this.floor.get(s)! <= y - STOREY_MIN_MOUNT) pick = s;
    return pick;
  }

  /** The 1-based LEVEL (lowest storey = 1) of a point an unknown height above
   *  its floor — storeyAt's answer as FloorManager numbers floors. */
  levelAt(y: number): number | null {
    const s = this.storeyAt(y);
    return s === null ? null : this.order.indexOf(s) + 1;
  }

  /** The storey of a point STANDING on a floor at `floorY` — a probed
   *  surface, the walker's feet: the storey whose floor is nearest. */
  storeyStandingOn(floorY: number): number | null {
    let best: number | null = null, d = Infinity;
    for (const s of this.order) {
      const e = Math.abs(this.floor.get(s)! - floorY);
      if (e < d) { d = e; best = s; }
    }
    return best;
  }

  /** The floor of the storey above `storey`; Infinity at the top. */
  floorAbove(storey: number | null): number {
    if (storey === null) return Infinity;
    const i = this.order.indexOf(storey);
    return i >= 0 && i + 1 < this.order.length ? this.floor.get(this.order[i + 1])! : Infinity;
  }

  /** The rooms on a storey. */
  roomsOn(storey: number | null): R[] {
    return storey === null ? [] : this.rooms.filter((r) => this.of.get(r) === storey);
  }

  /** The room a point an unknown height above its floor is IN: containing it,
   *  on its storey (storeyAt). */
  roomAt(x: number, y: number, z: number): R | null {
    const s = this.storeyAt(y);
    for (const r of this.rooms) if (this.of.get(r) === s && pointInPolygon(x, z, r.pts)) return r;
    return null;
  }

  /**
   * The room a point STANDING on `floorY` is in: of the rooms containing it and
   * not under the storey above (see aboveCeiling), the one whose own floor is NEAREST — for the callers that already know which
   * floor they are on (the walker's feet, a landing anchor, a probed floor),
   * rather than guessing from a fixture's mounting height.
   *
   * ⚠️ TWO QUESTIONS, NOT ONE, and collapsing them is what broke the walk-in room
   * banner in 2.437.0. `storeyAt` answers "here is a point at an UNKNOWN
   * height above its floor — which storey does it belong to", and it has to work
   * from a clearance because a ceiling lamp and the floor above it are
   * centimetres apart. That rule needs the storeys to be metres apart to be safe.
   * This one answers "I am STANDING on a floor at exactly this height" — the
   * walker's feet, a landing anchor, a probed floor under a fixture — where the
   * nearest floor is simply the right answer and no threshold is involved.
   *
   * The banner is what happens when the wrong one is used: this villa reports
   * THREE distinct room floor heights, so a group partway between the storeys
   * (a terrace, a step-down, a room whose per-storey probe found nothing and
   * answered 0) sat above the walker's eye-minus-clearance and won the storey
   * test, excluding the ground floor the walker was actually standing in. Every
   * room was then filtered out and the banner showed NOTHING. Nearest-floor
   * cannot do that: it always returns one of the candidates it was given, so a
   * reader that had an answer before can never lose it to this rule.
   *
   * ⚠️ ALLOCATION-FREE — the walking camera asks this every frame. Ties keep the
   * FIRST room, so a single-storey villa behaves as it always did.
   */
  roomStandingOn(x: number, floorY: number, z: number): R | null {
    let best: R | null = null, d = Infinity;
    for (const r of this.rooms) {
      if (!pointInPolygon(x, z, r.pts) || this.aboveCeiling(r, floorY)) continue;
      const e = Math.abs(r.floorY - floorY);
      if (e < d) { d = e; best = r; }
    }
    return best;
  }

  /** The stairwell containing a plan point, if any — where nobody stands. */
  stairwellAt(x: number, z: number): R | null {
    for (const r of this.rooms) if (isStairwell(r.name) && pointInPolygon(x, z, r.pts)) return r;
    return null;
  }

  /** The ground floor's rooms: the lowest storey's, stairwells excluded —
   *  a stair room is on storey 1 in the plan but its floor is a tread, which
   *  the old "lowest floor + 0.30 m" rule excluded by height. */
  groundRooms(): R[] {
    return this.order.length ? this.roomsOn(this.order[0]).filter((r) => !isStairwell(r.name)) : [];
  }

  /** The floor of the room a point stands in or above: of the rooms
   *  containing it on its own storey, the highest floor not above it. Null
   *  outside every room. */
  floorUnder(x: number, y: number, z: number): number | null {
    let best: number | null = null;
    for (const r of this.rooms) {
      if (r.floorY > y + FLOOR_SLACK_M || this.aboveCeiling(r, y) || !pointInPolygon(x, z, r.pts)) continue;
      if (best === null || r.floorY > best) best = r.floorY;
    }
    return best;
  }
}
