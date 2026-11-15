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
import type { Storeys } from "./storeys";

/** The map's cell, unless the plan is so large that MASK_MAX_CELLS cells
 *  across would not cover it. */
const MASK_CELL_M = 0.1;
const MASK_MAX_CELLS = 1024;
/** A room's outline reaches this far into the walls around it (never into
 *  another room): its own walls' faces are its room's, wherever the plan drew
 *  the outline in the wall's thickness. */
export const MASK_GROW_M = 0.3;
/** How far in front of a surface (along its normal) the map is read. A wall's
 *  thickness belongs to no room, and the bedroom's face of a wall it shares
 *  with a stairwell open to the living room took the living room's light
 *  through it (owner, 2026-11-16): read in front, a face is the room it
 *  faces. Past MASK_GROW_M, so it leaves the wall; a floor reads straight
 *  down. */
export const MASK_FACING_M = 0.35;
/** Where the walls are read, above each storey's floor. */
export const WALL_PROBE_ABOVE_M = 1.9;
/** A border this long without a wall is open plan; a doorway is less. */
export const OPEN_BORDER_M = 1.5;
/** How far from the shared border a wall is looked for. */
const BORDER_NEAR_M = 0.35;
const WALL_NEAR_M = 0.3;
const STEP_M = 0.1;
/** One bit per room, per storey. A room past the 32nd of its storey has none:
 *  lamps in it are not held back, and its surfaces read as no room. */
const BITS = 32;

/** A lamp's room, as the shader reads it: the storey's band of the map, and
 *  the rooms it lights as two exact floats (24 low bits, 8 high bits). */
export interface LampRoomBits { band: number; lo: number; hi: number }

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
  /** The open borders, as `name|name` keys — what is cached per model. */
  open: string[];
}

/** One triangle in world space, nine numbers. */
export type TriangleVisitor = (visit: (ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number) => void) => void;

interface Grid { originX: number; originZ: number; cell: number; width: number; rows: number }

/** `a|b`, the same whichever way round. */
export const borderKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Draw the plan's rooms into a map, and find which neighbours are open to
 * each other: from `known` (a previous load's answer for the same model and
 * plan), else from the model's walls (`triangles`); with neither, every
 * border counts as walled.
 */
type MaskRoom = { name: string; pts: Pt2[]; floorY: number; storey?: number };

export function buildRoomLightMask<R extends MaskRoom>(
  storeys: Storeys<R>, triangles: TriangleVisitor | null, known?: readonly string[],
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
  // Two passes. Inside an outline, a cell is that room's alone; only a cell
  // inside NO outline (a wall's thickness, the ground beyond) takes the rooms
  // within MASK_GROW_M — their own walls' faces. Grown into the next room, it
  // let the corridor light the bathroom's corner beside it (owner, 2026-11-16).
  const inside = new Uint32Array(cells * storeyKeys.length);
  const near = new Uint32Array(cells * storeyKeys.length);
  for (const [r, { band, bit }] of bitOf) {
    const rb = boundsXZ(r.pts)!;
    const c0 = Math.max(0, Math.floor((rb.minX - MASK_GROW_M - grid.originX) / cell));
    const c1 = Math.min(grid.width - 1, Math.floor((rb.maxX + MASK_GROW_M - grid.originX) / cell));
    const r0 = Math.max(0, Math.floor((rb.minZ - MASK_GROW_M - grid.originZ) / cell));
    const r1 = Math.min(grid.rows - 1, Math.floor((rb.maxZ + MASK_GROW_M - grid.originZ) / cell));
    const flag = (1 << bit) >>> 0;
    for (let row = r0; row <= r1; row++) {
      const z = grid.originZ + (row + 0.5) * cell;
      for (let col = c0; col <= c1; col++) {
        const x = grid.originX + (col + 0.5) * cell;
        const i = band * cells + row * grid.width + col;
        if (pointInPolygon(x, z, r.pts)) inside[i] |= flag;
        else if (distanceToPolygonBoundary(x, z, r.pts) <= MASK_GROW_M) near[i] |= flag;
      }
    }
  }
  const words = new Uint32Array(cells * storeyKeys.length);
  for (let i = 0; i < words.length; i++) words[i] = inside[i] || near[i];
  const open = known ? [...known]
    : triangles ? openBorders(storeys, [...bitOf.keys()], wallMaps(storeys, storeyKeys, grid, triangles), bandOf, grid)
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
  };
}

/** Whether a lamp of these bits lights a surface at (x, z) facing (nx, nz)
 *  across the floor — what the shader asks of the map, for the oracle. */
export function maskAllows<R>(mask: RoomLightMask<R>, bits: LampRoomBits | undefined, px: number, pz: number,
  nx = 0, nz = 0): boolean {
  if (!bits) return true;
  const x = px + nx * MASK_FACING_M, z = pz + nz * MASK_FACING_M;
  const col = Math.floor((x - mask.originX) / mask.cell), row = Math.floor((z - mask.originZ) / mask.cell);
  if (col < 0 || row < 0 || col >= mask.width || row >= mask.rows) return true;
  const i = ((bits.band * mask.rows + row) * mask.width + col) * 4;
  const cellBits = (mask.data[i] | (mask.data[i + 1] << 8) | (mask.data[i + 2] << 16) | (mask.data[i + 3] << 24)) >>> 0;
  const lampMask = (bits.lo + bits.hi * 0x1000000) >>> 0;
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
