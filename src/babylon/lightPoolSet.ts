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
import { LightPool, poolStrength } from "./LightPools";
import type { Pt2 } from "@/utils/geometry";
import { Storeys } from "./storeys";
import { placeLight, LIGHT_POOL_RADIUS, POOL_FLOOR_LIFT, type LightPlacement } from "./lightPlacement";

// Where each light stands — its floor, room, storey, the glow's floor and
// ceiling, the pool's reach — is lightPlacement's, one answer per pool that
// the pool AND the glow read. Its constants are re-exported for the callers.
export { LIGHT_POOL_RADIUS, POOL_FLOOR_LIFT } from "./lightPlacement";

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

export interface PoolRoom { name: string; pts: Pt2[]; floorY: number; storey?: number }

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
  /** Every storey question about `rooms` (storeys.ts). */
  private storeys = new Storeys<PoolRoom>([]);
  /** Where each pool's light stands (lightPlacement) — read by the pool and
   *  by the glow alike. */
  private placements = new Map<LightPool, LightPlacement<PoolRoom>>();
  /** Bumped by anything that changes what `glowLamps` would answer. */
  version = 0;
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
  setRooms(plan: Storeys<PoolRoom>): void {
    // The plan SceneManager built — the same object the badges and the
    // camera read, never one of its own.
    this.storeys = plan;
    const rooms = plan.rooms;
    if (this.pools.size === 0 || rooms.length === 0) return;
    // The memoised answers were keyed by grid on the load path; dropping them
    // lets the same points be re-asked now that the probe can name their room.
    // Owned HERE: a reshape against a stale memo is the whole defect.
    this.probe.clearMemo();
    const recovered = this.retryPending();
    const n = { clipped: 0, whole: 0, bounded: 0, nofloor: 0, corrected: 0, nearFixture: 0, lowered: 0, crushed: 0 };
    for (const pools of this.pools.values()) for (const pool of pools) this.reshapeOne(pool, n);
    this.probe.save();
    this.version++;
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

  /** One fixture's light changed. */
  setLight(meshId: number, r: LightReading): void {
    for (const pool of this.pools.get(meshId) ?? []) this.show(pool, r);
    this.version++;
  }

  /**
   * The same lights, for the furniture under them (lampGlow.ts): one per
   * pool that is on, at its FIXTURE (the spot above the pool, at the height
   * it was probed from), with the pool's own colour, strength and radius, and
   * its room's floor. Same bulb, same amount — the rule lives here, once.
   *
   * ⚠️ NOT from the fixture's PointLight. A PointLight's intensity is divided
   * among every bulb of its entity (EntityVisuals' lightShare): the villa's
   * nine living-room ceiling spots are one light, so each lit the table with a
   * NINTH while its pool lit the floor with the whole — the table under them
   * stayed dark (the owner's photo, 2026-09-25). A strip's PointLight is also
   * merged and dropped toward what is below, which is not where it shines from.
   */
  glowLamps(): { x: number; y: number; z: number; r: number; g: number; b: number;
                 amount: number; radius: number; floorY: number; ceilingY: number }[] {
    const out: { x: number; y: number; z: number; r: number; g: number; b: number;
                 amount: number; radius: number; floorY: number; ceilingY: number }[] = [];
    for (const [meshId, r] of this.readings()) {
      if (!r.on) continue;
      for (const pool of this.pools.get(meshId) ?? []) {
        const p = pool.mesh.position;
        out.push({
          x: p.x, y: pool.probeFromY, z: p.z,
          r: r.colour.r, g: r.colour.g, b: r.colour.b,
          amount: poolStrength(r.frac * this.strength, pool.intensityScale),
          radius: pool.radius,
          // The glow's floor and ceiling are the placement's — never rebuilt
          // here from pool fields. Before calibration: the pool's own floor.
          floorY: this.placements.get(pool)?.glowFloorY ?? p.y - POOL_FLOOR_LIFT,
          ceilingY: this.placements.get(pool)?.ceilingY ?? Infinity,
        });
      }
    }
    return out;
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
    this.version++;
    if (this.pools.size === 0) return;
    for (const [meshId, r] of this.readings()) this.setLight(meshId, r);
  }

  clear(): void {
    this.pools.forEach((arr) => arr.forEach((p) => p.dispose()));
    this.pools.clear();
    this.placements.clear();
    this.version++;
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
    const at = placeLight(pool.mesh.position.x, pool.mesh.position.z, pool.probeFromY,
      pool.mesh.position.y - POOL_FLOOR_LIFT, this.probe, this.storeys);
    for (const k of at.notes) n[k] = (n[k] ?? 0) + 1;
    this.placements.set(pool, at);
    pool.floorless = at.floorless;
    if (at.floorless) pool.mesh.setEnabled(false);
    pool.reshape(at.shape, at.radius, at.surfaceY === null ? undefined : at.surfaceY + POOL_FLOOR_LIFT);
  }
}
