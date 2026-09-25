// src/babylon/lightPoolSet.ts
// Every light pool in the villa, from fixture to floor — one module.
//
// ⚠️ A POOL'S LIFE WAS SPREAD OVER EIGHT SITES IN EntityVisuals. Creation was
// written twice (the load path and the retry, line for line), the caller set
// the pool's `intensityScale` and `probeFromY` by hand at both, the brightness
// formula was written three times, the storey rule was chosen at the call
// site, and the probe memo was cleared only as a side effect of reshaping. The
// pool bugs of the last releases were all in that wiring, not in LightPool:
//   * a pool never created, because a load-path probe miss was final (2.434.0);
//   * a pool on the wrong storey, because the call site asked the clearance
//     rule for a floor the pool was standing ON (2.477.0, 23ac0167);
//   * a pool stuck to the ceiling its fixture hangs from (2.476.0).
// Each is now a decision inside this module, and tests/oracles/light_pools.mjs
// replays them against a fake floor.
//
// Interface: `addFixture` on the load path, `setRooms` after calibration,
// `setLight` on a state change, `setStrength` from the slider, `resync` after a
// floor switch, `clear` on unload. The floor probe comes in as a port —
// FloorProbe in the app — and the live readings as a callback, so the module
// can repaint a pool it creates late without knowing what an entity is.

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { LightPool, poolFootprint } from "./LightPools";
import { clipPolygonToConvex, distanceToPolygonBoundary, pointInPolygon, type Pt2 } from "@/utils/geometry";
import { onStorey, storeyFloorYAt, nearestFloorRoom } from "./roomStorey";

/** A pool's radius on open floor. A separate knob from EntityVisuals'
 *  LIGHT_RANGE, which only matters for a non-baked villa's real PointLight. */
export const LIGHT_POOL_RADIUS = 1.8;
/** Floor for the radius of a pool that belongs to NO room polygon and so is
 *  bounded by the nearest room's edge instead. Without a floor, a fixture on a
 *  boundary would shrink to nothing and read as an unlit lamp. */
const POOL_MIN_RADIUS = 0.4;
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

/** What the pools need from the floor below them. FloorProbe is the adapter. */
export interface PoolFloorProbe {
  /** The floor under (x, z) seen from height y, skipping `exclude`. Cached. */
  below(x: number, y: number, z: number, exclude?: AbstractMesh): number | null;
  /** The same question, never answered from the cache. */
  describeBelow(x: number, y: number, z: number): { y: number } | null;
  clearMemo(): void;
  save(): void;
  readonly stats: { probeAbove: number };
}

/** One light's state as a pool shows it. `on` already folds in whether the
 *  fixture's storey is shown; `frac` is brightness × the per-light override. */
export interface LightReading { on: boolean; colour: Color3; frac: number }

export interface PoolRoom { name: string; pts: Pt2[]; floorY: number }

/** A fixture's box, as the load path already has it. */
export interface FixtureBounds {
  min: { x: number; z: number };
  max: { x: number; z: number };
  centerY: number;
}

interface PendingSpot { mesh: AbstractMesh; x: number; z: number; y: number; scale: number; i: number }

export class LightPoolSet {
  /** Keyed by fixture mesh uniqueId — a compact fixture has one pool, a strip
   *  three (centre at full strength, both ends at half, so two strips meeting
   *  at a corner light it without doubling into a hotspot). */
  private pools = new Map<number, LightPool[]>();
  /** Spots whose load-path probe missed, kept so calibration can ask again. */
  private pending = new Map<number, PendingSpot[]>();
  private rooms: readonly PoolRoom[] = [];
  private strength = 1;
  // Plain fields rather than parameter properties: Node's type stripping
  // cannot run the shorthand, and the oracle loads this class directly.
  private readonly scene: Scene;
  private readonly probe: PoolFloorProbe;
  /** Every fixture's current reading, for repainting pools in bulk. */
  private readonly readings: () => Iterable<[number, LightReading]>;
  private readonly log: (line: string) => void;

  constructor(
    scene: Scene,
    probe: PoolFloorProbe,
    readings: () => Iterable<[number, LightReading]>,
    log: (line: string) => void = () => {},
  ) {
    this.scene = scene;
    this.probe = probe;
    this.readings = readings;
    this.log = log;
  }

  get size(): number { return this.pools.size; }

  /**
   * A fixture found on the load path. `isStrip` gives it three pools instead
   * of one. A spot whose floor probe misses is NOT final: the load path's
   * probe is keyed by a 4-metre grid (no room resolver exists yet) that can
   * merge a void next door into this fixture's cell, so the spot waits for
   * `setRooms` to ask again, room-keyed. No mesh is allocated until then.
   *
   * Built as the plain footprint: room polygons do not exist yet, and clipping
   * waits for `setRooms`, off the critical path.
   */
  addFixture(mesh: AbstractMesh, box: FixtureBounds, isStrip: boolean): void {
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const alongX = box.max.x - box.min.x >= box.max.z - box.min.z;
    const spots = !isStrip ? [{ x: cx, z: cz, scale: 1 }]
      : alongX
        ? [{ x: cx, z: cz, scale: 1 }, { x: box.min.x, z: cz, scale: 0.5 }, { x: box.max.x, z: cz, scale: 0.5 }]
        : [{ x: cx, z: cz, scale: 1 }, { x: cx, z: box.min.z, scale: 0.5 }, { x: cx, z: box.max.z, scale: 0.5 }];
    const made: LightPool[] = [];
    spots.forEach(({ x, z, scale }, i) => {
      const spot = { mesh, x, z, y: box.centerY, scale, i };
      const pool = this.build(spot);
      if (pool) made.push(pool);
      else this.pending.set(mesh.uniqueId, [...(this.pending.get(mesh.uniqueId) ?? []), spot]);
    });
    this.pools.set(mesh.uniqueId, made);
  }

  /**
   * The calibrated rooms have landed (or changed): retry every deferred spot,
   * then give each pool its room's shape and its real floor height. Runs once
   * per calibration, after first paint — never on a state change.
   */
  setRooms(rooms: readonly PoolRoom[]): void {
    this.rooms = rooms;
    if (this.pools.size === 0 || rooms.length === 0) return;
    // The memoised answers were keyed by grid on the load path; dropping them
    // lets the same points be re-asked now that the probe can name their room.
    // Owned HERE: a reshape against a stale memo is the whole defect.
    this.probe.clearMemo();
    const recovered = this.retryPending();
    const n = { clipped: 0, whole: 0, bounded: 0, nofloor: 0, corrected: 0, nearFixture: 0, lowered: 0, crushed: 0 };
    for (const pools of this.pools.values()) for (const pool of pools) this.reshapeOne(pool, n);
    this.probe.save();
    // A pool created just now has never been shown a state — the state pass
    // ran long before calibration — so an already-ON light would keep a dark
    // pool until its next change.
    if (recovered) this.resync();
    this.log(
      `light pools: clipped=${n.clipped} whole=${n.whole} bounded=${n.bounded} nofloor=${n.nofloor}`
      + ` corrected=${n.corrected} nearFixture=${n.nearFixture} lowered=${n.lowered} crushed=${n.crushed}`
      + ` bucketAbove=${this.probe.stats.probeAbove}`
      + ` recovered=${recovered} stillNoFloor=${[...this.pending.values()].reduce((k, s) => k + s.length, 0)}`
      + ` rooms=${rooms.length} storeys=${new Set(rooms.map((r) => Math.round(r.floorY))).size}`,
    );
  }

  /** The floor a fixture's pools lie on — the lowest, for a strip's three —
   *  or null when it has none. The lamp glow starts above it (lampGlow.ts). */
  floorYOf(meshId: number): number | null {
    let y: number | null = null;
    for (const pool of this.pools.get(meshId) ?? []) {
      const f = pool.mesh.position.y - POOL_FLOOR_LIFT;
      if (y === null || f < y) y = f;
    }
    return y;
  }

  /** One fixture's light changed. */
  setLight(meshId: number, r: LightReading): void {
    for (const pool of this.pools.get(meshId) ?? []) this.show(pool, r);
  }

  /** The global "Light effect strength". Returns whether it changed. */
  setStrength(value: number): boolean {
    if (value === this.strength) return false;
    this.strength = value;
    this.resync();
    return true;
  }

  /** Repaint every pool from the current readings — after a floor switch (a
   *  pool is not indexed by FloorManager, so it would stay lit over a hidden
   *  storey) or anything else that changes an input without a state event. */
  resync(): void {
    if (this.pools.size === 0) return;
    for (const [meshId, r] of this.readings()) this.setLight(meshId, r);
  }

  clear(): void {
    this.pools.forEach((arr) => arr.forEach((p) => p.dispose()));
    this.pools.clear();
    // Holds mesh references from the outgoing model — a reload's calibration
    // must not retry spots belonging to a scene that no longer exists.
    this.pending.clear();
  }

  private show(pool: LightPool, r: LightReading): void {
    pool.setState(r.on, r.colour, r.frac * this.strength);
  }

  /** A pool on the floor under a spot, or null if the probe finds none. */
  private build(spot: PendingSpot): LightPool | null {
    const surfaceY = this.probe.below(spot.x, spot.y, spot.z, spot.mesh);
    if (surfaceY === null) return null;
    const pool = new LightPool(
      this.scene, `${spot.mesh.name}_${spot.mesh.uniqueId}_${spot.i}`,
      new Vector3(spot.x, surfaceY + POOL_FLOOR_LIFT, spot.z), LIGHT_POOL_RADIUS);
    pool.intensityScale = spot.scale;
    pool.probeFromY = spot.y;
    return pool;
  }

  private retryPending(): number {
    let created = 0;
    for (const [meshId, spots] of [...this.pending]) {
      const still: PendingSpot[] = [];
      const pools = this.pools.get(meshId) ?? [];
      for (const spot of spots) {
        const pool = this.build(spot);
        if (pool) { pools.push(pool); created++; } else still.push(spot);
      }
      if (pools.length) this.pools.set(meshId, pools);
      if (still.length) this.pending.set(meshId, still); else this.pending.delete(meshId);
    }
    return created;
  }

  private reshapeOne(pool: LightPool, n: Record<string, number>): void {
    const x = pool.mesh.position.x, z = pool.mesh.position.z;
    // PROBE FIRST, then resolve the room — the order is the correctness
    // argument. A ceiling lamp hangs within centimetres of the slab overhead,
    // the very height that slab reports as the next storey's floor, so a
    // storey read off the FIXTURE is ambiguous exactly where lights live. A
    // downward ray answers "which floor is physically under it" by touching it.
    let surfaceY = this.probe.below(x, pool.probeFromY, z);
    if (surfaceY === null) n.nofloor++;
    else if (pool.probeFromY - surfaceY < POOL_AIRBORNE_M) {
      // Within half a metre of its own fixture: either stuck to the ceiling it
      // hangs from (a neighbour under a soffit answered the room-and-height
      // bucket first), or genuinely mounted close to what it lights — a stair
      // light, a plinth strip. Opposite responses, so ask again uncached and
      // let the fresh answer win.
      const fresh = this.probe.describeBelow(x, pool.probeFromY, z);
      if (fresh && Math.abs(fresh.y - surfaceY) > 2 * POOL_FLOOR_LIFT) { surfaceY = fresh.y; n.corrected++; }
      else n.nearFixture++;
    } else {
      // ⚠️ A DISC FLOATING AT TABLE HEIGHT (reproduced 2026-09-25 on the villa
      // GLB: 60 of 112 pools through this module, nine of them the living and
      // dining lamps at 0.75 m over a floor at 0). The probe's memo is keyed
      // `room | round(height)`, so every lamp mounted at ~2 m in an open-plan
      // room shared the FIRST answer — the kitchen light's, correctly over a
      // 0.75 m counter. The airborne rule above cannot see it: 0.75 m is well
      // clear of a 2.2 m fixture.
      //
      // A pool is a glow ON THE FLOOR; what stands under a lamp — the table,
      // the counter — is lit by the lamp glow (lampGlow.ts: fused furniture
      // is lightmapped structure, where a PointLight is multiplied away) or,
      // for a separate furniture mesh, by the fixture's PointLight. So an answer
      // well above the room's own floor is replaced BY that floor. No ray: the
      // room's floor height is already known (fitted once from the plan), and
      // re-asking the probe was measured at ~20 ms a pool, a hitch on every
      // load. Deterministic too — it cannot depend on what the memo held.
      // Step and stair lights never reach here: the airborne branch above
      // keeps a pool mounted close to what it lights.
      const roomFloor = this.floorUnder(x, surfaceY, z);
      if (roomFloor !== null && surfaceY - roomFloor > POOL_RAISED_M) { surfaceY = roomFloor; n.lowered++; }
    }
    // ⚠️ TWO RULES, AND WHAT WE KNOW PICKS ONE (2.477.0). A probed surface is
    // a floor being stood ON — nearest-floor. A fixture height is an unknown
    // distance ABOVE one — clearance. Asking the clearance rule about a floor
    // the pool stands on names the storey below, so every upper-storey pool
    // found no room and washed through its walls.
    const room = surfaceY !== null ? this.roomOnFloor(x, surfaceY, z) : this.roomAtFixture(x, pool.probeFromY, z);
    let radius = LIGHT_POOL_RADIUS;
    let shape: Pt2[] | undefined;
    if (room) {
      // Room = SUBJECT (may be L-shaped), footprint = CLIP (convex).
      const cut = clipPolygonToConvex(room.pts, poolFootprint(x, z, radius));
      if (cut.length >= 3) { shape = cut; n.clipped++; } else n.whole++;
    } else {
      // Outside every polygon on this storey: bound the radius by the nearest
      // SAME-STOREY room boundary, so it still cannot cross a wall. Measuring
      // against every storey let a bedroom wall one floor up crush a terrace
      // pool to POOL_MIN_RADIUS.
      const storeyY = surfaceY !== null
        ? (this.roomOnFloor(x, surfaceY, z)?.floorY ?? surfaceY)
        : storeyFloorYAt(this.rooms, pool.probeFromY);
      let nearest = Infinity;
      for (const r of this.rooms) {
        if (!onStorey(r.floorY, storeyY)) continue;
        nearest = Math.min(nearest, distanceToPolygonBoundary(x, z, r.pts));
      }
      if (Number.isFinite(nearest)) radius = Math.min(radius, Math.max(POOL_MIN_RADIUS, nearest));
      n.bounded++;
      if (radius <= POOL_MIN_RADIUS + 1e-3) n.crushed++;
    }
    pool.reshape(shape, radius, surfaceY === null ? undefined : surfaceY + POOL_FLOOR_LIFT);
  }

  /** The floor of the room this point stands in or above: of the rooms whose
   *  outline contains it, the highest floor not above `y` (a small tolerance
   *  for a slab's own thickness). Null outside every room. */
  private floorUnder(x: number, y: number, z: number): number | null {
    let best: number | null = null;
    for (const r of this.rooms) {
      if (r.floorY > y + 0.05 || !pointInPolygon(x, z, r.pts)) continue;
      if (best === null || r.floorY > best) best = r.floorY;
    }
    return best;
  }

  /** Nearest-floor rule: the room a point STANDING on floorY is in. */
  private roomOnFloor(x: number, floorY: number, z: number): PoolRoom | null {
    return nearestFloorRoom(this.rooms, floorY, (r) => pointInPolygon(x, z, r.pts));
  }

  /** Clearance rule: the room a point an unknown height above its floor is in. */
  private roomAtFixture(x: number, y: number, z: number): PoolRoom | null {
    const storeyY = storeyFloorYAt(this.rooms, y);
    for (const room of this.rooms) {
      if (onStorey(room.floorY, storeyY) && pointInPolygon(x, z, room.pts)) return room;
    }
    return null;
  }
}
