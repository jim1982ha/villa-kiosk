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
// Interface: `addFixture` on the load path, `setRooms` once the plan and the
// fixtures are both in (lampRooms.ts decides when: every lamp placed in one
// step, lightPlacement.placeLights, and each pool shown its placement),
// `setLight` on a state change, `setStrength` from the slider, `resync` after
// a floor switch, `placed` to read where each pool stands, `clear` on unload. The floor probe comes in as a port — FloorProbe in the app — and
// the live readings as a callback, so the module can repaint a pool it creates
// late without knowing what an entity is; which rooms a lamp of a room lights
// is a port too (lampRooms.ts).

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { LightPool, POOL_ALPHA_STOPS, poolStrength } from "./LightPools";
import type { Pt2 } from "@/utils/geometry";
import type { Storeys } from "./storeys";
import { placeLights, LIGHT_POOL_RADIUS, POOL_FLOOR_LIFT, type LightPlacement, type VillaLamp } from "./lightPlacement";
import type { LampRoomBits } from "./roomLightMask";
import type { FloorArea } from "./floorProbe";

// Where each light stands — its floor, room, storey, the glow's floor and
// ceiling, the pool's reach — is lightPlacement's, one answer per pool that
// the pool AND the glow read.

/** What the pools need from the floor below them. FloorProbe is the adapter. */
export interface PoolFloorProbe {
  /** The floor under (x, z) seen from height y, skipping `exclude`. Cached. */
  below(x: number, y: number, z: number, exclude?: AbstractMesh): number | null;
  /** The same question, never answered from the cache. */
  describeBelow(x: number, y: number, z: number): { y: number } | null;
  /** The floor most of an area of a storey lies on (lightPlacement). */
  areaFloorY(area: FloorArea, storey: number): number | null;
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

/** Metres between the pools along an LED strip (stripSpots): close enough,
 *  against a pool's 1.8 m reach, that the floor along the strip reads as one
 *  even band. */
export const STRIP_POOL_STEP_M = 0.6;
/** A strip's light, in pools' worth per metre of strip: what a 3 m strip's
 *  centre pool and two half-strength end pools gave before (2), so a strip of
 *  that length is as bright as it was. Never under those 2 for a short one.
 *
 *  ⚠️ PER METRE, NOT PER STRIP (owner, 2026-11-20). One total for every strip,
 *  spread evenly along a 7.7 m curtain-top strip, left its band at a third of
 *  a pool's centre: the room went dark where the old middle spot had lit it.
 *  A longer strip carries more LEDs, so it gives more light. */
const STRIP_LIGHT_PER_M = 2 / 3;
const STRIP_LIGHT_MIN = 2;

/**
 * Where a horizontal strip's pools lie: a row of equal pools along its length,
 * about STRIP_POOL_STEP_M apart, the first and last half a step in from its
 * ends, sharing the strip's light (evenShares).
 *
 * ⚠️ A STRIP IS A LINE OF LIGHT, NOT THREE SPOTS (owner, 2026-11-19: "100% in
 * the middle, 50% at each end"). Its centre pool at full strength and one at
 * half on each end lit the floor as three patches. Half a step in from each
 * end, two strips meeting at a corner each stop short of it by as much as
 * their own pools are apart, so the corner is lit like the rest of the band,
 * never doubled.
 */
function stripSpots(box: FixtureBounds): { x: number; z: number; scale: number }[] {
  const alongX = box.max.x - box.min.x >= box.max.z - box.min.z;
  const from = alongX ? box.min.x : box.min.z, to = alongX ? box.max.x : box.max.z;
  const across = alongX ? (box.min.z + box.max.z) / 2 : (box.min.x + box.max.x) / 2;
  const n = Math.max(2, Math.round((to - from) / STRIP_POOL_STEP_M));
  const step = (to - from) / n;
  const at = Array.from({ length: n }, (_, i) => from + step * (i + 0.5));
  const share = evenShares(at, Math.max(STRIP_LIGHT_MIN, STRIP_LIGHT_PER_M * (to - from)));
  return at.map((t, i) => (alongX ? { x: t, z: across, scale: share[i] } : { x: across, z: t, scale: share[i] }));
}

/** Where a fixture's pools lie and each one's share of its light: a strip's row (stripSpots), or one at the middle of
 *  a compact fixture. The 3D view's pools stand on them, and the villa pictures light each one (BulbSet.lampSpots). */
export function fixtureSpots(box: FixtureBounds, isStrip: boolean): { x: number; z: number; scale: number }[] {
  return isStrip ? stripSpots(box) : [{ x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, scale: 1 }];
}

/**
 * How the strip's light (`total`, STRIP_LIGHT_PER_M) is shared among pools at these points
 * along it, so the floor under every one of them is equally bright: equal
 * shares leave the middle a third brighter than near the ends, where fewer
 * neighbours overlap; the shares that solve "every pool's spot gets the same
 * sum" give the ends a little more. Equal shares if that has no positive
 * answer.
 */
function evenShares(at: number[], total: number): number[] {
  const n = at.length;
  const falloff = (d: number) => {
    const t = d / LIGHT_POOL_RADIUS;
    for (let i = 0; i < POOL_ALPHA_STOPS.length - 1; i++) {
      const [t0, a0] = POOL_ALPHA_STOPS[i], [t1, a1] = POOL_ALPHA_STOPS[i + 1];
      if (t <= t1) return a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
    }
    return 0;
  };
  // A w = 1 by Gaussian elimination (A is the pools' overlap: symmetric,
  // its diagonal the largest in each row).
  const m = at.map((a) => [...at.map((b) => falloff(Math.abs(a - b))), 1]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    if (Math.abs(m[c][c]) < 1e-12) return at.map(() => total / n);
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const w = m.map((row, i) => row[n] / row[i]);
  const sum = w.reduce((a, b) => a + b, 0);
  if (!w.every((v) => v > 0) || !(sum > 0)) return at.map(() => total / n);
  return w.map((v) => (v * total) / sum);
}

export class LightPoolSet {
  /** Keyed by fixture mesh uniqueId — a compact fixture has one pool, a strip
   *  a row of equal ones along it (stripSpots). */
  private pools = new Map<number, LightPool[]>();
  /** Spots whose load-path probe missed, kept so calibration can ask again. */
  private pending = new Map<number, PendingSpot[]>();
  /** Where each pool's light stands (lightPlacement) — read by the pool and
   *  by the glow alike. */
  private placements = new Map<LightPool, LightPlacement<PoolRoom>>();
  /** Which light each fixture belongs to (setGroups): fixture mesh uniqueId
   *  → its light's index. */
  private groupOf = new Map<number, number>();
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
  /** Which rooms a lamp of a room lights; undefined: any. */
  private readonly roomBits: (room: PoolRoom | null | undefined) => LampRoomBits | undefined;

  constructor(
    scene: Scene,
    probe: PoolFloorProbe,
    readings: () => Iterable<[number, LightReading]>,
    log: (line: string) => void = () => {},
    roomBits: (room: PoolRoom | null | undefined) => LampRoomBits | undefined = () => undefined,
  ) {
    this.scene = scene;
    this.probe = probe;
    this.readings = readings;
    this.log = log;
    this.roomBits = roomBits;
  }

  /**
   * A fixture found on the load path. `isStrip` gives it a row of pools along
   * its length (stripSpots) instead of one. A spot whose floor probe misses is
   * NOT final: the load path's
   * probe is keyed by a 4-metre grid (no room resolver exists yet) that can
   * merge a void next door into this fixture's cell, so the spot waits for
   * `setRooms` to ask again, room-keyed. No mesh is allocated until then.
   *
   * Built as the plain footprint: room polygons do not exist yet, and clipping
   * waits for `setRooms`, off the critical path.
   */
  addFixture(mesh: AbstractMesh, box: FixtureBounds, isStrip: boolean): void {
    const spots = fixtureSpots(box, isStrip);
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
   * The calibrated rooms have landed, or the fixtures were built again under
   * them: retry every deferred spot, then give each pool its room's shape and
   * its real floor height. Called by lampRooms.ts once per change of either,
   * before the next frame — never on a state change.
   */
  setRooms(plan: Storeys<PoolRoom>, openTo: (room: PoolRoom) => readonly PoolRoom[] = () => []): void {
    // The plan SceneManager built — the same object the badges and the
    // camera read, never one of its own.
    const rooms = plan.rooms;
    if (this.pools.size === 0 || rooms.length === 0) return;
    // The memoised answers were keyed by grid on the load path; dropping them
    // lets the same points be re-asked now that the probe can name their room.
    // Owned HERE: a reshape against a stale memo is the whole defect.
    this.probe.clearMemo();
    const recovered = this.retryPending();
    // Where every lamp's light stands, in one step (lightPlacement.placeLights);
    // the pools show it.
    const pools: LightPool[] = [];
    const lamps: VillaLamp[] = [];
    for (const [meshId, list] of this.pools) for (const pool of list) {
      pools.push(pool);
      lamps.push({ x: pool.fixtureX, z: pool.fixtureZ, fromY: pool.probeFromY,
        floorY: pool.mesh.position.y - POOL_FLOOR_LIFT, light: this.groupOf.get(meshId) });
    }
    const { placements, counts } = placeLights(lamps, { probe: this.probe, storeys: plan, openTo });
    pools.forEach((pool, i) => this.apply(pool, placements[i]));
    const n = (k: string) => counts[k] ?? 0;
    this.probe.save();
    this.version++;
    // A pool created just now has never been shown a state — the state pass
    // ran long before calibration — so an already-ON light would keep a dark
    // pool until its next change.
    if (recovered) this.resync();
    this.log(
      `light pools: clipped=${n("clipped")} whole=${n("whole")} bounded=${n("bounded")} nofloor=${n("nofloor")}`
      + ` corrected=${n("corrected")} nearFixture=${n("nearFixture")} lowered=${n("lowered")} crushed=${n("crushed")} flight=${n("flight")} edge=${n("edge")} spread=${n("spread")}`
      + ` bucketAbove=${this.probe.stats.probeAbove}`
      + ` recovered=${recovered} stillNoFloor=${[...this.pending.values()].reduce((k, s) => k + s.length, 0)}`
      + ` rooms=${rooms.length} storeys=${new Set(rooms.map((r) => Math.round(r.floorY))).size}`,
    );
  }

  /** Which fixtures are one light's (its entity's meshes), after the load:
   *  a lamp on a room's edge takes the room the others stand in. */
  setGroups(lights: Iterable<readonly AbstractMesh[]>): void {
    this.groupOf.clear();
    let i = 0;
    for (const meshes of lights) { for (const m of meshes) this.groupOf.set(m.uniqueId, i); i++; }
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
                 amount: number; radius: number; floorY: number; ceilingY: number; room?: LampRoomBits }[] {
    const out: { x: number; y: number; z: number; r: number; g: number; b: number;
                 amount: number; radius: number; floorY: number; ceilingY: number; room?: LampRoomBits }[] = [];
    for (const [meshId, r] of this.readings()) {
      if (!r.on) continue;
      for (const pool of this.pools.get(meshId) ?? []) {
        const p = pool.mesh.position;
        out.push({
          // At the fixture, not the patch's centre (lightPlacement.edgeRoom).
          x: pool.fixtureX, y: pool.probeFromY, z: pool.fixtureZ,
          r: r.colour.r, g: r.colour.g, b: r.colour.b,
          amount: poolStrength(r.frac * this.strength, pool.intensityScale),
          radius: pool.radius,
          // The glow's floor and ceiling are the placement's — never rebuilt
          // here from pool fields. Before calibration: the pool's own floor.
          floorY: this.placements.get(pool)?.glowFloorY ?? p.y - POOL_FLOOR_LIFT,
          ceilingY: this.placements.get(pool)?.ceilingY ?? Infinity,
          // The rooms it lights: its placement's room and those open to it.
          room: this.roomBits(this.placements.get(pool)?.room),
        });
      }
    }
    return out;
  }

  /**
   * Every pool and where its light stands (undefined: not placed yet, before
   * the plan): the read the render rig and the `render` report take, instead
   * of reaching into this module's maps.
   */
  placed(): { mesh: AbstractMesh; fixture: { x: number; y: number; z: number }; at: LightPlacement<PoolRoom> | undefined }[] {
    const out: ReturnType<LightPoolSet["placed"]> = [];
    for (const pools of this.pools.values()) for (const pool of pools) {
      out.push({ mesh: pool.mesh, fixture: { x: pool.fixtureX, y: pool.probeFromY, z: pool.fixtureZ }, at: this.placements.get(pool) });
    }
    return out;
  }

  /** How many pools there are, and how many have no room yet. */
  roomCounts(): { lamps: number; noRoom: number } {
    const all = this.placed();
    return { lamps: all.length, noRoom: all.filter((p) => !p.at?.room).length };
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
    this.groupOf.clear();
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

  /** A pool shows where its light stands: its floor, its outline, its centre. */
  private apply(pool: LightPool, at: LightPlacement<PoolRoom>): void {
    this.placements.set(pool, at);
    pool.setFloorless(at.floorless);   // the pool decides its visibility
    pool.reshape(at.shape, at.radius, at.surfaceY === null ? undefined : at.surfaceY + POOL_FLOOR_LIFT, { x: at.cx, z: at.cz });
  }
}
