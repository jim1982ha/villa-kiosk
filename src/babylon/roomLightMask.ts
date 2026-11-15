// src/babylon/roomLightMask.ts
// WHICH ROOM A SURFACE IS IN, for the lamp glow (lampGlow.ts): a bulb lights
// its own room, and the rooms open onto it, never the room behind a wall.
//
// ⚠️ THE GLOW KNOWS NO WALL (owner, 2026-11-16: the corridor light upstairs
// lit the bathroom beside it). It lights every surface within BULB_REACH_M
// that faces the bulb, and the far wall of the next room faces it through
// the partition. Shadow maps are the textbook answer and cost six renders of
// the villa per lit bulb; the plan already knows the rooms. So each storey's
// rooms are drawn, once, into a small top-down map, one bit per room, and a
// lamp lights a surface only where the map carries its room's bit, or a
// neighbour's it is open to, or no room at all (the garden beyond the plan,
// as before).
//
// ⚠️ OPEN PLAN. A plan draws the living room and the kitchen as two rooms
// with no wall between them; cut there, a lamp would stop at a line on the
// floor. So the walls are read off the model: every opaque structure face
// at WALL_PROBE_ABOVE_M over a storey's floor (above the furniture a
// SweetHome export fuses into the structure, under the door heads, so a
// doorway reads as a gap), and two rooms whose shared border has more than
// OPEN_BORDER_M without a wall share their light. A doorway is narrower: the
// bathroom off a corridor stays dark.
//
// Pure: the triangles are passed in (bulbSet.ts reads them from the model).
// tests/oracles/room_light_mask.mjs.

import { boundsXZ, distanceToPolygonBoundary, pointInPolygon, type Pt2 } from "@/utils/geometry";
import { isStairwell, type Storeys } from "./storeys";

/** The map's cell, unless the plan is so large that MASK_MAX_CELLS cells
 *  across would not cover it. */
const MASK_CELL_M = 0.1;
const MASK_MAX_CELLS = 1024;
/** A room's outline reaches this far into the walls around it (never into
 *  another room): its own walls' faces are its room's, wherever the plan drew
 *  the outline in the wall's thickness. */
export const MASK_GROW_M = 0.3;
/** How far in front of a WALL's face (along its normal) the map is read: a
 *  wall's thickness lies between two rooms, and its faces are the rooms they
 *  face. Only a surface standing in a wall cell: a bed head against the wall
 *  it shares with the living room, read in front, was the living room's and
 *  took its light (owner, 2026-11-16). A surface in a wall that faces up
 *  (the wall's top, a rail against it) read the outline the wall lies in,
 *  and the living room lit the bedroom's wall tops and bed-head rails
 *  (owner, 2026-11-16): it is lit only if every room around it, this far
 *  each way, is — a shelf of a tall bookcase inside the room still is. */
export const MASK_FACING_M = 0.25;
/** A room's flood starts this far inside its outline (closer, a cell may be
 *  the next room's, across a wall the plan drew a little off). */
const SEED_DEPTH_M = 0.5;
/** A staircase's own walls stand within this of its outline. */
const FLIGHT_EDGE_M = 0.2;
/** Where the walls are read, above each storey's floor. */
export const WALL_PROBE_ABOVE_M = 1.9;
/** A border this long without a wall is open plan; a doorway is less. */
export const OPEN_BORDER_M = 1.5;
/** How far from the shared border a wall is looked for. */
const BORDER_NEAR_M = 0.35;
const WALL_NEAR_M = 0.3;
const STEP_M = 0.1;
/** One bit per room, per storey; the 32nd marks a wall cell. A room past the
 *  31st of its storey has none: lamps in it are not held back, and its
 *  surfaces read as no room. */
const BITS = 31;
const WALL_BIT = 0x80000000;

/** A lamp's room, as the shader reads it: the storey's band of the map, and
 *  the rooms it lights as two exact floats (24 low bits, 8 high bits). */
export interface LampRoomBits { band: number; lo: number; hi: number }

/** What a device keeps per model and plan, so a load reads no wall again:
 *  the open borders, and each band's wall cells as [start, length] runs. */
export interface RoomLightKnown { open: string[]; walls: number[][] }

export interface RoomLightMask<R> {
  /** RGBA bytes, `bands` maps of `rows` rows of `width` cells, stacked. */
  data: Uint8Array;
  width: number;
  rows: number;
  bands: number;
  originX: number;
  originZ: number;
  cell: number;
  /** The rooms each room's lamps may light (its own and those open to it). */
  bitsOf(room: R | null | undefined): LampRoomBits | undefined;
  /** The open borders, as `name|name` keys. */
  open: string[];
  /** What to keep for the next load (RoomLightKnown). */
  known: RoomLightKnown;
}

/** One triangle in world space, nine numbers. */
export type TriangleVisitor = (visit: (ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number) => void) => void;

interface Grid { originX: number; originZ: number; cell: number; width: number; rows: number }

/** `a|b`, the same whichever way round. */
export const borderKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

type MaskRoom = { name: string; pts: Pt2[]; floorY: number; storey?: number };

/**
 * Draw the plan's rooms into a map, with the walls between them, and find
 * which neighbours are open to each other: from `known` (a previous load's
 * answer for the same model and plan), else from the model's walls
 * (`triangles`); with neither, no wall is known and every border is walled.
 *
 * A cell's rooms, in order:
 *  * the rooms that reach it from their middle without crossing a wall, the
 *    nearest first (several: a tie). An outline drawn a little across a wall
 *    is the room it lies in, not the one whose outline it is;
 *  * else the outlines it lies in (a closet the flood cannot enter);
 *  * else the outlines within MASK_GROW_M (a wall's thickness);
 * and a staircase keeps its whole outline: its flight stands over the rooms
 * built under it, and its lights light the steps above them.
 */
export function buildRoomLightMask<R extends MaskRoom>(
  storeys: Storeys<R>, triangles: TriangleVisitor | null, known?: RoomLightKnown,
): RoomLightMask<R> | null {
  const rooms = storeys.rooms;
  const b = boundsXZ(rooms.flatMap((r) => r.pts));
  if (!b || rooms.length === 0) return null;
  const pad = MASK_GROW_M + MASK_CELL_M;
  const spanX = b.maxX - b.minX + 2 * pad, spanZ = b.maxZ - b.minZ + 2 * pad;
  const cell = Math.max(MASK_CELL_M, Math.max(spanX, spanZ) / MASK_MAX_CELLS);
  const grid: Grid = { originX: b.minX - pad, originZ: b.minZ - pad, cell,
    width: Math.ceil(spanX / cell), rows: Math.ceil(spanZ / cell) };
  // Bands: the plan's storeys, lowest first.
  const storeyKeys = [...new Set(rooms.map((r) => storeys.storeyOf(r)).filter((s): s is number => s !== null))]
    .sort((p, q) => storeys.floorY(p) - storeys.floorY(q));
  const bandOf = new Map(storeyKeys.map((s, i) => [s, i]));
  const bitOf = new Map<R, { band: number; bit: number }>();
  const perBand = storeyKeys.map(() => 0);
  for (const r of rooms) {
    const band = bandOf.get(storeys.storeyOf(r)!);
    if (band === undefined || perBand[band] >= BITS) continue;
    bitOf.set(r, { band, bit: perBand[band]++ });
  }
  const cells = grid.width * grid.rows;
  const walls = known && known.walls.length === storeyKeys.length
    ? known.walls.map((runs) => fromRuns(runs, cells))
    : triangles ? wallMaps(storeys, storeyKeys, grid, triangles)
    : storeyKeys.map(() => new Uint8Array(cells));
  const inside = new Uint32Array(cells * storeyKeys.length);
  const near = new Uint32Array(cells * storeyKeys.length);
  const seeds = new Uint32Array(cells * storeyKeys.length);
  const stairs = storeyKeys.map(() => 0);
  /** Inside a staircase, clear of its edge: a flight rising past
   *  WALL_PROBE_ABOVE_M reads as wall there (its upper treads and risers),
   *  and is not one. */
  const flight = new Uint8Array(cells * storeyKeys.length);
  for (const [r, { band, bit }] of bitOf) {
    const flag = (1 << bit) >>> 0;
    if (isStairwell(r.name)) stairs[band] = (stairs[band] | flag) >>> 0;
    const rb = boundsXZ(r.pts)!;
    const c0 = Math.max(0, Math.floor((rb.minX - MASK_GROW_M - grid.originX) / cell));
    const c1 = Math.min(grid.width - 1, Math.floor((rb.maxX + MASK_GROW_M - grid.originX) / cell));
    const r0 = Math.max(0, Math.floor((rb.minZ - MASK_GROW_M - grid.originZ) / cell));
    const r1 = Math.min(grid.rows - 1, Math.floor((rb.maxZ + MASK_GROW_M - grid.originZ) / cell));
    let seeded = false;
    const insideCells: number[] = [];
    for (let row = r0; row <= r1; row++) {
      const z = grid.originZ + (row + 0.5) * cell;
      for (let col = c0; col <= c1; col++) {
        const x = grid.originX + (col + 0.5) * cell;
        const i = band * cells + row * grid.width + col;
        const d = distanceToPolygonBoundary(x, z, r.pts);
        if (pointInPolygon(x, z, r.pts)) {
          inside[i] |= flag;
          if (d > FLIGHT_EDGE_M && isStairwell(r.name)) flight[i] = 1;
          if (!walls[band][i - band * cells]) {
            insideCells.push(i);
            if (d >= SEED_DEPTH_M) { seeds[i] |= flag; seeded = true; }
          }
        } else if (d <= MASK_GROW_M) near[i] |= flag;
      }
    }
    // A room too narrow to have a middle starts from all of it.
    if (!seeded) for (const i of insideCells) seeds[i] |= flag;
  }
  const words = new Uint32Array(cells * storeyKeys.length);
  for (let band = 0; band < storeyKeys.length; band++) {
    const o = band * cells;
    const reached = flood(grid, walls[band], seeds.subarray(o, o + cells), inside.subarray(o, o + cells), near.subarray(o, o + cells));
    for (let c = 0; c < cells; c++) {
      const i = o + c;
      const own = reached[c] ? (reached[c] | (inside[i] & stairs[band])) >>> 0 : inside[i] || near[i];
      words[i] = (walls[band][c] && !flight[i] ? (own | WALL_BIT) : own) >>> 0;
    }
  }
  const open = known ? [...known.open]
    : triangles ? openBorders(storeys, [...bitOf.keys()], walls, bandOf, grid)
    : [];
  const openSet = new Set(open);
  const lampBits = new Map<R, LampRoomBits>();
  for (const [r, { band, bit }] of bitOf) {
    let mask = (1 << bit) >>> 0;
    for (const [o, ob] of bitOf) if (ob.band === band && o !== r && openSet.has(borderKey(r.name, o.name))) mask = (mask | (1 << ob.bit)) >>> 0;
    lampBits.set(r, { band, lo: mask & 0xffffff, hi: mask >>> 24 });
  }
  const data = new Uint8Array(words.buffer.slice(0));   // little-endian: byte 0 = bits 0..7
  return {
    data, width: grid.width, rows: grid.rows, bands: storeyKeys.length,
    originX: grid.originX, originZ: grid.originZ, cell,
    bitsOf: (room) => (room ? lampBits.get(room) : undefined),
    open,
    known: { open, walls: walls.map(toRuns) },
  };
}

/** Every room spreads from its seeds at once, a cell a step, through cells
 *  that are no wall and lie in or near its outline; a cell is the room(s)
 *  that reach it first. */
function flood(grid: Grid, wall: Uint8Array, seeds: Uint32Array, inside: Uint32Array, near: Uint32Array): Uint32Array {
  const n = grid.width * grid.rows;
  const got = new Uint32Array(n);
  let front: number[] = [];
  for (let i = 0; i < n; i++) if (seeds[i]) { got[i] = seeds[i]; front.push(i); }
  while (front.length) {
    const next = new Map<number, number>();
    for (const i of front) {
      const col = i % grid.width;
      for (const j of [i - 1, i + 1, i - grid.width, i + grid.width]) {
        if (j < 0 || j >= n || got[j] || wall[j]) continue;
        if ((j === i - 1 && col === 0) || (j === i + 1 && col === grid.width - 1)) continue;
        const bits = (got[i] & (inside[j] | near[j])) >>> 0;
        if (bits) next.set(j, ((next.get(j) ?? 0) | bits) >>> 0);
      }
    }
    front = [];
    for (const [j, bits] of next) { got[j] = bits; front.push(j); }
  }
  return got;
}

/** Wall cells as [start, length, start, length, ...]. */
function toRuns(m: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    let j = i;
    while (j < m.length && m[j]) j++;
    out.push(i, j - i);
    i = j;
  }
  return out;
}
function fromRuns(runs: number[], cells: number): Uint8Array {
  const m = new Uint8Array(cells);
  for (let k = 0; k + 1 < runs.length; k += 2) m.fill(1, runs[k], Math.min(cells, runs[k] + runs[k + 1]));
  return m;
}

/** Whether a lamp of these bits lights a surface at (x, z) facing (nx, nz)
 *  across the floor — what the shader asks of the map, for the oracle. */
export function maskAllows<R>(mask: RoomLightMask<R>, bits: LampRoomBits | undefined, px: number, pz: number,
  nx = 0, nz = 0): boolean {
  if (!bits) return true;
  const at = (x: number, z: number): number | null => {
    const col = Math.floor((x - mask.originX) / mask.cell), row = Math.floor((z - mask.originZ) / mask.cell);
    if (col < 0 || row < 0 || col >= mask.width || row >= mask.rows) return null;
    const i = ((bits.band * mask.rows + row) * mask.width + col) * 4;
    return (mask.data[i] | (mask.data[i + 1] << 8) | (mask.data[i + 2] << 16) | (mask.data[i + 3] << 24)) >>> 0;
  };
  const cellBits = at(px, pz);
  if (cellBits === null) return true;
  const lampMask = (bits.lo + bits.hi * 0x1000000) >>> 0;
  if (cellBits & WALL_BIT) {
    // In a wall: a face is the room it faces, read in front of it; what
    // faces no room (a wall's top, a rail against it) is no room's.
    const side = Math.hypot(nx, nz);
    if (side >= 0.5) {
      const front = at(px + (nx / side) * MASK_FACING_M, pz + (nz / side) * MASK_FACING_M);
      return !!front && !(front & WALL_BIT) && (front & lampMask) !== 0;
    }
    // Facing up: lit only if every room around it is.
    const around = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dz]) => at(px + dx * MASK_FACING_M, pz + dz * MASK_FACING_M))
      .filter((c): c is number => !!c && !(c & WALL_BIT));
    return around.length > 0 && around.every((c) => (c & lampMask) !== 0);
  }
  return cellBits === 0 || (cellBits & lampMask) !== 0;
}

/** Per storey band, the cells a wall crosses at WALL_PROBE_ABOVE_M. */
function wallMaps<R extends MaskRoom>(storeys: Storeys<R>, storeyKeys: number[], grid: Grid, triangles: TriangleVisitor): Uint8Array[] {
  const maps = storeyKeys.map(() => new Uint8Array(grid.width * grid.rows));
  const planes = storeyKeys.map((s) => storeys.floorY(s) + WALL_PROBE_ABOVE_M);
  const mark = (m: Uint8Array, x: number, z: number) => {
    const col = Math.floor((x - grid.originX) / grid.cell), row = Math.floor((z - grid.originZ) / grid.cell);
    if (col >= 0 && row >= 0 && col < grid.width && row < grid.rows) m[row * grid.width + col] = 1;
  };
  triangles((ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const lo = Math.min(ay, by, cy), hi = Math.max(ay, by, cy);
    for (let k = 0; k < planes.length; k++) {
      const y = planes[k];
      if (y < lo || y > hi || hi - lo < 1e-4) continue;
      // The triangle's edges that cross the plane: one segment.
      const pts: number[] = [];
      const cross = (px: number, py: number, pz: number, qx: number, qy: number, qz: number) => {
        if ((py - y) * (qy - y) > 0 || py === qy) return;
        const t = (y - py) / (qy - py);
        pts.push(px + (qx - px) * t, pz + (qz - pz) * t);
      };
      cross(ax, ay, az, bx, by, bz); cross(bx, by, bz, cx, cy, cz); cross(cx, cy, cz, ax, ay, az);
      if (pts.length < 4) continue;
      const [x0, z0, x1, z1] = pts;
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (grid.cell / 2)));
      for (let i = 0; i <= n; i++) mark(maps[k], x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n);
    }
  });
  return maps;
}

/** The borders between rooms of one storey with more than OPEN_BORDER_M
 *  along them and no wall near. */
function openBorders<R extends MaskRoom>(
  storeys: Storeys<R>, rooms: R[], walls: Uint8Array[], bandOf: Map<number, number>, grid: Grid,
): string[] {
  const reach = Math.ceil(WALL_NEAR_M / grid.cell);
  const walled = (m: Uint8Array, x: number, z: number) => {
    const col = Math.floor((x - grid.originX) / grid.cell), row = Math.floor((z - grid.originZ) / grid.cell);
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= grid.width || r >= grid.rows) continue;
      if ((dc * dc + dr * dr) * grid.cell * grid.cell > WALL_NEAR_M * WALL_NEAR_M) continue;
      if (m[r * grid.width + c]) return true;
    }
    return false;
  };
  const out: string[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const band = bandOf.get(storeys.storeyOf(a)!);
      if (band === undefined || band !== bandOf.get(storeys.storeyOf(b)!) || a.name === b.name) continue;
      let openM = 0;
      for (let e = 0; e < a.pts.length; e++) {
        const p = a.pts[e], q = a.pts[(e + 1) % a.pts.length];
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        const n = Math.max(1, Math.round(len / STEP_M));
        for (let s = 0; s < n; s++) {
          const x = p.x + ((q.x - p.x) * (s + 0.5)) / n, z = p.z + ((q.z - p.z) * (s + 0.5)) / n;
          if (distanceToPolygonBoundary(x, z, b.pts) > BORDER_NEAR_M) continue;
          if (!walled(walls[band], x, z)) openM += len / n;
        }
      }
      if (openM > OPEN_BORDER_M) out.push(borderKey(a.name, b.name));
    }
  }
  return out;
}
