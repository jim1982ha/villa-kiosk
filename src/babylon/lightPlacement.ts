// src/babylon/lightPlacement.ts
// WHERE A LIGHT STANDS — the one answer both its floor pool (lightPoolSet /
// LightPools) and its lamp glow (lampGlow.ts) read: the surface under it, its
// room, whether that room has a floor to lie on, the floor its glow is held
// back below and the storey above that stops it, and the pool's reach.
//
// ⚠️ ABOUT NINE DECISIONS, INSIDE THE POOL MODULE, READ BY THE GLOW OFF POOL
// FIELDS (round 7, 2.496.126). The probe, the airborne re-ask, the raised →
// room-floor lowering, the room by two rules, the stairwell's floorless disc
// (2.496.116), the glow's floor and ceiling, the bounded reach: each written
// where a pool mesh was being reshaped, testable only with a Babylon engine,
// and the glow reconstructing its floor from a pool-only map. The stair
// defect lived exactly there.
//
// PURE: the floor probe is a port (FloorProbe in the app, a script in the
// oracle), the plan is Storeys. tests/oracles/light_placement.mjs.

import { clipPolygonToConvex, distanceToPolygonBoundary, regularPolygon, type Pt2 } from "@/utils/geometry";
import { isStairwell, type Storeys } from "./storeys";

/** How far a bulb's light reaches before it has faded out: the furniture
 *  light's (lampGlow.ts), the bulb's PointLight's (bulbSet.ts) and the floor
 *  patch's, one number. An early 8 m lit straight through walls into the next
 *  rooms. */
export const BULB_REACH_M = 4;
/** The least a pool reaches on open floor; a lamp's patch reaches where its
 *  light meets the floor (placeLight), at least this far. */
export const LIGHT_POOL_RADIUS = 1.8;
/** Floor for the radius of a pool that belongs to NO room polygon and so is
 *  bounded by the nearest room's edge instead. Without a floor, a fixture on a
 *  boundary would shrink to nothing and read as an unlit lamp. */
export const POOL_MIN_RADIUS = 0.4;
/** Closer than this to its own fixture, a pool is not on a floor — it is on the
 *  ceiling the fixture hangs from. Below any real mounting height, far above
 *  the few centimetres a ceiling lamp clears its slab by. */
const POOL_AIRBORNE_M = 0.5;
/** How far a pool sits above the floor it was probed onto — clear of
 *  z-fighting, and still reading as lying ON it. */
export const POOL_FLOOR_LIFT = 0.02;
/** A pool whose floor answer stands this far above its room's own floor is put
 *  ON the room's floor. Above a stair tread's rise; below any table or counter. */
const POOL_RAISED_M = 0.3;
/** How far below the tread under it a light over a flight still lights: the
 *  step or two below its own. Below that is the next lamp's, or the room
 *  built under the flight, whose ceiling is the flight's underside a riser
 *  and a slab below the tread. */
export const STAIR_GLOW_BELOW_M = 0.5;

/** Sides of the pool's own footprint when it is not clipped to a room. Eight
 *  bounds a disc far more tightly than a square while staying convex — which
 *  `clipPolygonToConvex` requires of the CLIP argument (see geometry.ts). The
 *  corners it leaves outside the disc land where the gradient is already fully
 *  transparent, so they cost a few transparent fragments and nothing else. */
const POOL_FOOTPRINT_SIDES = 8;

/**
 * The pool's own footprint, as a CONVEX polygon — the clip region to intersect
 * a room with (`clipPolygonToConvex` requires the CLIP to be convex; the room,
 * which may be L-shaped, is the subject).
 *
 * Sized by its INSCRIBED circle rather than its circumscribed one: at
 * circumradius `radius` an octagon's edge midpoints fall at 0.92·radius, where
 * the gradient still carries ~5% alpha, and that would print the octagon's
 * straight edges faintly onto the floor. Inflating by 1/cos(π/n) puts the whole
 * disc strictly inside, so the falloff reaches 0 before the boundary and the
 * polygon is never visible as a shape.
 */
export function poolFootprint(cx: number, cz: number, radius: number): Pt2[] {
  const circum = radius / Math.cos(Math.PI / POOL_FOOTPRINT_SIDES);
  return regularPolygon(cx, cz, circum, POOL_FOOTPRINT_SIDES);
}

/** What placement needs from the floor below. FloorProbe is the adapter. */
interface PlacementProbe {
  /** The floor under (x, z) seen from height y. Cached. */
  below(x: number, y: number, z: number): number | null;
  /** The same question, never answered from the cache. */
  describeBelow(x: number, y: number, z: number): { y: number } | null;
}

export interface PlacementRoom { name: string; pts: Pt2[]; floorY: number; storey?: number }

export interface LightPlacement<R extends PlacementRoom = PlacementRoom> {
  /** The floor the pool lies on; null when the probe found none. */
  surfaceY: number | null;
  room: R | null;
  /** A staircase: no one floor to lie on, so no disc (2.496.116). */
  floorless: boolean;
  /** The glow is held back below this: the ROOM's floor, or for a light over
   *  a flight STAIR_GLOW_BELOW_M under its tread (never below its storey's
   *  floor), so the room built under the flight stays dark. */
  glowFloorY: number;
  /** The floor of the storey above: the glow stops at it (Infinity: none). */
  ceilingY: number;
  /** The pool's reach, and its room-clipped outline when it has a room. */
  radius: number;
  shape: Pt2[] | undefined;
  /** How each answer was reached — the load log's counters. */
  notes: string[];
}

/**
 * Where the light at (x, z), mounted at `fromY`, stands. `currentFloorY` is
 * the floor its pool was first put on (the load path's probe), the glow's
 * floor when nothing better is known.
 */
export function placeLight<R extends PlacementRoom>(
  x: number, z: number, fromY: number, currentFloorY: number,
  probe: PlacementProbe, storeys: Storeys<R>,
  /** How far its patch may spread before it meets another patch in its room
   *  (LightPoolSet). Left out, the patch keeps LIGHT_POOL_RADIUS. */
  spreadM = LIGHT_POOL_RADIUS,
): LightPlacement<R> {
  const notes: string[] = [];
  // PROBE FIRST, then resolve the room — the order is the correctness
  // argument. A ceiling lamp hangs within centimetres of the slab overhead,
  // the very height that slab reports as the next storey's floor, so a
  // storey read off the FIXTURE is ambiguous exactly where lights live. A
  // downward ray answers "which floor is physically under it" by touching it.
  let surfaceY = probe.below(x, fromY, z);
  // ⚠️ OVER A FLIGHT, NEVER THE MEMO'S ANSWER (owner, 2026-11-16). The probe's
  // memo is keyed `room | round(height)`, and the step lights along a flight
  // share a room and, a metre at a time, a height: the upper ones were handed
  // a lower lamp's tread, read as a table under a ceiling lamp, and "lowered"
  // onto the floor of the room under the flight. A few rays, once a load.
  const overStairs = surfaceY !== null && storeys.stairwellAt(x, z) !== null;
  if (overStairs) {
    const fresh = probe.describeBelow(x, fromY, z);
    if (fresh && Math.abs(fresh.y - surfaceY!) > 2 * POOL_FLOOR_LIFT) { surfaceY = fresh.y; notes.push("corrected"); }
  }
  // ⚠️ A LIGHT OVER A FLIGHT LIGHTS THE FLIGHT. Asked before anything that
  // lowers the surface or names a room by its floor: the plan's room under
  // the flight shares the staircase's floor, so both rules handed a step
  // light that room (Storeys.flightAt).
  const flight = surfaceY !== null ? storeys.flightAt(x, surfaceY, z) : null;
  if (flight) notes.push("flight");
  else if (surfaceY === null) notes.push("nofloor");
  else if (fromY - surfaceY < POOL_AIRBORNE_M) {
    // Within half a metre of its own fixture: either stuck to the ceiling it
    // hangs from (a neighbour under a soffit answered the room-and-height
    // bucket first), or genuinely mounted close to what it lights — a stair
    // light, a plinth strip. Opposite responses, so ask again uncached and
    // let the fresh answer win.
    const fresh = overStairs ? null : probe.describeBelow(x, fromY, z);
    if (fresh && Math.abs(fresh.y - surfaceY) > 2 * POOL_FLOOR_LIFT) { surfaceY = fresh.y; notes.push("corrected"); }
    else notes.push("nearFixture");
  } else {
    // ⚠️ A DISC FLOATING AT TABLE HEIGHT (reproduced 2026-09-25 on the villa
    // GLB: 60 of 112 pools, nine of them the living and dining lamps at 0.75 m
    // over a floor at 0). The probe's memo is keyed `room | round(height)`, so
    // every lamp mounted at ~2 m in an open-plan room shared the FIRST answer —
    // the kitchen light's, over a 0.75 m counter. A pool is a glow ON THE
    // FLOOR (what stands under a lamp is the furniture light's), so an answer
    // well above the room's own floor is replaced BY that floor. No ray: the
    // room's floor is already known, and re-asking cost ~20 ms a pool.
    const roomFloor = storeys.floorUnder(x, surfaceY, z);
    if (roomFloor !== null && surfaceY - roomFloor > POOL_RAISED_M) { surfaceY = roomFloor; notes.push("lowered"); }
  }
  // ⚠️ TWO RULES, AND WHAT WE KNOW PICKS ONE (2.477.0). A probed surface is
  // a floor being stood ON — nearest-floor. A fixture height is an unknown
  // distance ABOVE one — clearance. Asking the clearance rule about a floor
  // the pool stands on names the storey below, so every upper-storey pool
  // found no room and washed through its walls.
  const room = flight ?? (surfaceY !== null ? storeys.roomStandingOn(x, surfaceY, z) : storeys.roomAt(x, fromY, z));
  // ⚠️ A STAIRCASE HAS NO FLOOR TO LAY A POOL ON (2.496.116). A disc at the
  // height of the tread under the lamp floated over the lower half of the
  // flight and lit it from the air. No disc; the lamp's light is the glow's
  // alone, which follows the treads.
  const floorless = !!room && isStairwell(room.name);
  const storeyOfRoom = room ? storeys.storeyOf(room) : null;
  let glowFloorY: number;
  let ceilingY: number;
  if (flight && surfaceY !== null) {
    // ⚠️ A FLIGHT'S LIGHT IS HELD BACK A LITTLE BELOW ITS OWN TREAD, NEVER AT
    // THE STOREY'S FLOOR. The room built under a flight lies below its treads
    // and has no floor of its own between them and the lamp, so a glow held
    // back only at the storey's floor lit that room through the steps. Below
    // the tread by STAIR_GLOW_BELOW_M: the steps under and around the lamp
    // stay lit, the room under them does not. It stops at the storey above
    // the FLIGHT, or above the LAMP when it hangs higher (a pendant down a
    // stairwell from the floor above lights that floor too).
    glowFloorY = Math.max(storeys.floorY(storeyOfRoom!), surfaceY - STAIR_GLOW_BELOW_M);
    ceilingY = Math.max(storeys.floorAbove(storeyOfRoom), storeys.floorAbove(storeys.storeyAt(fromY)));
  } else {
    const roomFloor = floorless && storeyOfRoom !== null
      ? storeys.floorY(storeyOfRoom)
      : surfaceY !== null ? storeys.floorUnder(x, surfaceY, z) : null;
    glowFloorY = roomFloor ?? surfaceY ?? currentFloorY;
    ceilingY = storeys.floorAbove(storeys.storeyStandingOn(glowFloorY));
  }
  // ⚠️ A LAMP ON ITS OWN LIGHTS THE FLOOR AS FAR AS ITS LIGHT GOES (owner,
  // 2026-11-16: the entrance light lit the hedge beside the path, and the
  // path under it stayed dark past a small disc). Everything standing above
  // the floor takes the lamp's light out to BULB_REACH_M (lampGlow.ts); the
  // floor takes only the patch, and a fixed LIGHT_POOL_RADIUS patch left it
  // dark where a kerb or a plant a hand higher was lit. So the patch reaches
  // where the lamp's light meets the floor, but only over floor no other
  // patch in its room lies on (`spreadM`, LightPoolSet): where lamps stand
  // close, as in a room of ceiling spots, their patches already overlap, and
  // widening them washed the floor out to white (render, 2026-11-16). Never
  // less than LIGHT_POOL_RADIUS, and still clipped to its room below, so
  // never past a wall.
  const drop = surfaceY !== null && !floorless ? fromY - surfaceY : null;
  const reach = drop !== null && drop < BULB_REACH_M ? Math.sqrt(BULB_REACH_M * BULB_REACH_M - drop * drop) : 0;
  let radius = Math.max(LIGHT_POOL_RADIUS, Math.min(reach, spreadM));
  let shape: Pt2[] | undefined;
  if (room) {
    // Room = SUBJECT (may be L-shaped), footprint = CLIP (convex).
    const cut = clipPolygonToConvex(room.pts, poolFootprint(x, z, radius));
    if (cut.length >= 3) { shape = cut; notes.push("clipped"); } else notes.push("whole");
  } else {
    // Outside every polygon on this storey: bound the radius by the nearest
    // SAME-STOREY room boundary, so it still cannot cross a wall. Measuring
    // against every storey let a bedroom wall one floor up crush a terrace
    // pool to POOL_MIN_RADIUS.
    const storey = surfaceY !== null ? storeys.storeyStandingOn(surfaceY) : storeys.storeyAt(fromY);
    let nearest = Infinity;
    for (const r of storeys.roomsOn(storey)) nearest = Math.min(nearest, distanceToPolygonBoundary(x, z, r.pts));
    if (Number.isFinite(nearest)) radius = Math.min(radius, Math.max(POOL_MIN_RADIUS, nearest));
    notes.push("bounded");
    if (radius <= POOL_MIN_RADIUS + 1e-3) notes.push("crushed");
  }
  return { surfaceY, room, floorless, glowFloorY, ceilingY, radius, shape, notes };
}
