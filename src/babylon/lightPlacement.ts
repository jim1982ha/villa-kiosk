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

import { clipPolygonToConvex, distanceToPolygonBoundary, earClipTriangulate, pointInPolygon, regularPolygon, type Pt2 } from "@/utils/geometry";
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
 *  ON the room's floor. Above a single step's rise; below any table, counter
 *  or tub. A light over a flight never comes here (the flight rule is asked
 *  first).
 *
 *  ⚠️ 0.3 LEFT A LAMP OVER A SUNKEN TUB LIGHTING THE AIR (owner, 2026-11-19):
 *  under it the probe met the tub's inside at 0.26 m, so the whole pool lay
 *  0.24 m above the pebbles round the tub, its rim a hard line floating over
 *  them. What stands under a lamp is the furniture light's; the pool is the
 *  floor's. */
const POOL_RAISED_M = 0.2;
/** How far below the tread under it a light over a flight still lights: the
 *  step or two below its own. Below that is the next lamp's, or the room
 *  built under the flight, whose ceiling is the flight's underside a riser
 *  and a slab below the tread. */
export const STAIR_GLOW_BELOW_M = 0.5;

/** A lamp this close to a room's outline is on its edge: a wall light, or a
 *  lamp whose bounding-box centre lies in the wall's thickness. Its room is
 *  chosen (edgeRoom) and its patch laid this far into that room. */
export const POOL_EDGE_M = 0.3;

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
  /** Where the patch is centred: the light's own x, z, or a lamp on a room's
   *  edge moved POOL_EDGE_M into its room (edgeRoom). */
  cx: number;
  cz: number;
  /** The pool's reach, and when it has a room its outline: convex pieces
   *  covering its room and each room open to it, cut to the reach. */
  radius: number;
  shape: Pt2[][] | undefined;
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
  /** The room the other lamps of its light stand in (LightPoolSet), the
   *  answer for one on that room's edge. */
  home: R | null = null,
  /** The rooms open to a room: no wall along their border, the room map's
   *  answer (roomLightMask). Left out, a patch stays in its own room. */
  openTo: (room: R) => readonly R[] = () => [],
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
  let room = flight ?? (surfaceY !== null ? storeys.roomStandingOn(x, surfaceY, z) : storeys.roomAt(x, fromY, z));
  // A lamp on a room's edge (edgeRoom): never over a flight or in a
  // stairwell, whose rules are above and below.
  let cx = x, cz = z;
  if (!flight && surfaceY !== null && !(room && isStairwell(room.name))) {
    const edge = edgeRoom(x, z, surfaceY, room, storeys, home, openTo);
    if (edge) { room = edge.room; cx = edge.x; cz = edge.z; notes.push("edge"); }
  }
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
  let shape: Pt2[][] | undefined;
  if (room) {
    // Room = SUBJECT (may be L-shaped), footprint = CLIP (convex).
    //
    // ⚠️ AND EVERY ROOM OPEN TO IT (owner, 2026-11-20: the terrace light
    // stopped at a straight line across the deck, where the terrace meets the
    // patio with no wall between). A room's outline is a line on a plan, not
    // a wall: where the room map finds no wall along a border (the same
    // answer the furniture light reads), the patch goes on into the next
    // room. Not into a stairwell (no disc on a flight), nor onto a floor at
    // another height, which would float or sink under it.
    const footprint = poolFootprint(cx, cz, radius);
    const opened = flight || floorless ? [] : openTo(room).filter((r) => !isStairwell(r.name)
      && storeys.storeyOf(r) === storeyOfRoom && Math.abs(r.floorY - room.floorY) <= POOL_RAISED_M);
    const pieces = [room, ...opened].flatMap((r) => roomInside(r.pts, footprint));
    if (pieces.length) { shape = pieces; notes.push("clipped"); } else notes.push("whole");
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
  return { surfaceY, room, floorless, glowFloorY, ceilingY, cx, cz, radius, shape, notes };
}

/**
 * The room of a lamp within POOL_EDGE_M of a room's outline, and where its
 * patch is centred: POOL_EDGE_M inside that room. Null when the lamp is on no
 * edge. The room is the one the other lamps of its light stand in (`home`),
 * else the room its centre is in, else (a centre in a wall's thickness, in no
 * room) the room holding the larger part of its patch.
 *
 * ⚠️ A WALL LIGHT'S ROOM WAS DECIDED BY CENTIMETRES (owner, 2026-11-19: the
 * light on the floor sat beside the lamp, sometimes left, sometimes right). A
 * fixture is often a 10 cm marker whose centre sits in the wall it is mounted
 * on, so which side of the outline it fell on, a calibration's rounding away,
 * sent its whole patch into the room behind the wall, or cut it to a half
 * disc against the wall with the bright half on the far side of the lamp. A
 * marker has no front to read, so the light's other lamps say which room it
 * lights.
 */
function edgeRoom<R extends PlacementRoom>(
  x: number, z: number, surfaceY: number, room: R | null, storeys: Storeys<R>, home: R | null,
  openTo: (room: R) => readonly R[],
): { room: R; x: number; z: number } | null {
  const near = storeys.roomsOn(storeys.storeyStandingOn(surfaceY))
    .filter((r) => !isStairwell(r.name) && (r === room || distanceToPolygonBoundary(x, z, r.pts) < POOL_EDGE_M));
  if (!near.some((r) => distanceToPolygonBoundary(x, z, r.pts) < POOL_EDGE_M)) return null;
  const area = (r: R) => polygonArea(clipPolygonToConvex(r.pts, poolFootprint(x, z, LIGHT_POOL_RADIUS)));
  const pick = home && near.includes(home) ? home
    : room && near.includes(room) ? room
    : near.reduce<R | null>((best, r) => (!best || area(r) > area(best) ? r : best), null);
  if (!pick) return null;
  // An edge with no wall along it is no edge: the patch goes on across it
  // (placeLight), so it stays under the lamp. Only a lamp by a room behind a
  // wall, or in a wall, has its patch laid into its own room.
  const open = new Set(openTo(pick));
  const walled = near.some((r) => r !== pick && !open.has(r))
    || ![pick, ...open].some((r) => pointInPolygon(x, z, r.pts));
  return { room: pick, ...(walled ? intoRoom(x, z, pick.pts, POOL_EDGE_M) : { x, z }) };
}

/** (x, z) moved to at least `depth` inside the polygon, along the line from
 *  its nearest point on the outline; unchanged when already that deep, or
 *  when the move would not land inside (a sliver narrower than twice it). */
function intoRoom(x: number, z: number, poly: Pt2[], depth: number): { x: number; z: number } {
  const inside = pointInPolygon(x, z, poly);
  let best = Infinity, nx = x, nz = z, ex = 0, ez = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].x, az = poly[j].z, dx = poly[i].x - ax, dz = poly[i].z - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; nx = px; nz = pz; ex = dx; ez = dz; }
  }
  if (inside && best >= depth) return { x, z };
  // Inward: from the outline toward the point when inside, away when not; on
  // the line itself, across the edge, whichever side is inside.
  let ux = inside ? x - nx : nx - x, uz = inside ? z - nz : nz - z;
  let len = Math.hypot(ux, uz);
  if (len < 1e-6) {
    const el = Math.hypot(ex, ez) || 1;
    ux = -ez / el; uz = ex / el; len = 1;
    if (!pointInPolygon(nx + ux * depth, nz + uz * depth, poly)) { ux = -ux; uz = -uz; }
  }
  const tx = nx + (ux / len) * depth, tz = nz + (uz / len) * depth;
  return pointInPolygon(tx, tz, poly) ? { x: tx, z: tz } : { x, z };
}

/** Each room outline's triangles, kept: a room is cut once per pool. */
const roomTriangles = new WeakMap<Pt2[], Pt2[][]>();

/**
 * The part of a room inside a convex region, as convex pieces: the room's own
 * triangles, each cut to the region.
 *
 * ⚠️ NOT THE ROOM CUT WHOLE (owner, 2026-11-20: the terrace's light stopped in
 * a hard line at the deck's edge, though the lawn beyond is open to it).
 * Cutting a concave outline to a convex region in one pass returns its parts
 * joined by zero-width seams along the region's edge; a garden drawn round
 * the house, with the terrace as a notch, came back as such a ring, and the
 * triangulation gave up on it partway: the lawn piece was mostly missing. A
 * triangle cut to a convex region is always one convex piece.
 */
function roomInside(pts: Pt2[], clip: Pt2[]): Pt2[][] {
  let tris = roomTriangles.get(pts);
  if (!tris) {
    tris = earClipTriangulate(pts).map(([a, b, c]) => [pts[a], pts[b], pts[c]]);
    roomTriangles.set(pts, tris);
  }
  return tris.map((t) => clipPolygonToConvex(t, clip)).filter((cut) => cut.length >= 3 && polygonArea(cut) > 1e-6);
}

/** A polygon's area (shoelace). */
function polygonArea(poly: Pt2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
  return Math.abs(a) / 2;
}
