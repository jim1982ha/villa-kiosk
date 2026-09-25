// src/babylon/storeys.ts
// Which storey a room, a height or a point is on — asked of ONE module.
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
import { nearestFloorRoom, STOREY_MIN_MOUNT } from "./roomStorey";

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

  /** The room a point STANDING on `floorY` is in: of the rooms containing
   *  it, the one whose own floor is nearest. */
  roomStandingOn(x: number, floorY: number, z: number): R | null {
    return nearestFloorRoom(this.rooms, floorY, (r) => pointInPolygon(x, z, r.pts));
  }

  /** The floor of the room a point stands in or above: of the rooms
   *  containing it, the highest floor not above it. Null outside every room. */
  floorUnder(x: number, y: number, z: number): number | null {
    let best: number | null = null;
    for (const r of this.rooms) {
      if (r.floorY > y + FLOOR_SLACK_M || !pointInPolygon(x, z, r.pts)) continue;
      if (best === null || r.floorY > best) best = r.floorY;
    }
    return best;
  }
}
