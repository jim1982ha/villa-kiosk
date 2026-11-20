// src/babylon/floorProbe.ts
//
// "What is the floor height here?" — asked from three places, answered three
// different ways until 2.300.0, and one of those ways was the cause of a real
// field bug (a light pool buried under the walkway it was meant to light).
//
//   EntityVisuals.surfaceBelow   light pools + label/strip drops
//   SceneManager.estimateFloorY  the first-person spawn, camera framing
//   RoomHighlight.buildDecal     the surface a point-room glow drapes over
//
// and since 2026-11-20 a fourth, which is an AREA's question, not a point's:
// the floor most of a room (villaPlan: its glow, its teleport point) or of a
// light pool's disc (lightPlacement) lies on — `areaFloorY`, one rule for
// both (see there).
//
// They are not the same question and this module does not pretend they are —
// the first wants the structure below a fixture, the second wants ONE STOREY's
// floor whether or not that storey is currently shown, the third wants the
// picked mesh and its normal, not a height. What they share, and what was
// duplicated three ways, is the downward ray, the "structure only, never
// furniture" predicate, the seam-nudge retry, and the memoisation. That is
// what lives here.
//
// All three scope themselves with a PICK PREDICATE, and that is load-bearing in
// a way that is easy to miss: a custom predicate replaces Babylon's
// enabled/visible/pickable filter rather than adding to it, so a hidden storey
// is picked exactly as well as a shown one. Until 2.355.0 `storeyFloorY` and
// the stair conform both force-showed their storey and put it back, believing
// the opposite — dead work, and a window in which a rendered frame would have
// drawn the wrong storey.
//
// ── The bucketing, and why it is keyed by ROOM ────────────────────────────
// These probes were THE load-time bottleneck: each ray is tested against every
// pickable mesh, and a baked villa's structure is a single ~1.4M-triangle mesh
// with no picking octree, so each call is a linear triangle scan. A few hundred
// of them ran synchronously before the villa could be shown (~950ms measured,
// 27% of visible load), which is why the answers are memoised at all.
//
// The justification for memoising has always been sound and is unchanged:
// what these probes want is the FLOOR under a fixture, floors are flat over a
// room, and every probe casts straight down — so two fixtures in the same room
// at the same ceiling height have the same answer BY CONSTRUCTION.
//
// What was wrong was the proxy. Until 2.300.0 the key was a 4-metre grid
// (`round(x/4):round(y):round(z/4)`), and 4 metres is not "the same room" — it
// merges straight THROUGH a wall whenever two fixtures land in one cell, which
// for a fixture mounted on an exterior wall is routine, not a corner case. The
// fixture then inherits the NEIGHBOURING room's floor height, and a pool placed
// at that height +2cm ends up under the floor it was supposed to sit on. The
// old comment even weighed 8m as "starting to merge genuinely separate rooms"
// without noticing that 4m already did.
//
// So the key is the ROOM — the justification implemented literally instead of
// approximated. It cannot merge across a wall, and it collapses MORE probes
// than the grid did (one ray per room per storey, rather than the grid's
// measured 5.6x), so this is faster as well as correct. The grid survives only
// as the fallback for a point inside no polygon at all (open ground, or a load
// that has not reached calibration yet — see LightPoolSet.setRooms).

import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { PickingInfo } from "@babylonjs/core/Collisions/pickingInfo";
import type { Scene } from "@babylonjs/core/scene";

import { roomKey } from "@/config/roomKey";
import { distanceToPolygonBoundary, pointInPolygon, pointInside, boundsXZ, type Pt2 } from "@/utils/geometry";
import { structureRole, isResolvedCeiling, rayTargets, isHelperMesh } from "./meshRoles";
import { ModelKeyedStore } from "./modelStore";
// Babylon prototype patches this module depends on — see babylonSideEffects.
import "./babylonSideEffects";

/** Fallback bucket size for a point that belongs to no room polygon. Only the
 *  fallback — see this file's header for why a grid is the wrong primary key. */
const FALLBACK_GRID_M = 4;
/** 20m, not the villa's actual max floor-to-fixture height: a probe that comes
 *  up short has no better answer than the nudge retry, so a generous ray only
 *  pays for itself on an actual miss and cheaply removes one whole class of
 *  those outright. */
const PROBE_REACH_M = 20;
/** A miss straight down CAN still mean the ray slipped through a hairline seam
 *  between two adjacent floor polygons — floors are exported per ROOM and
 *  adjoining edges don't always weld to bit-identical coordinates, most likely
 *  for a fixture sitting right at a wall, exactly where two rooms' floors meet.
 *  Nudging a few cm and retrying routes around that gap without needing to know
 *  which side of it the room's interior is on. */
const SEAM_NUDGE_M = 0.12;
/** What still lies ON a storey's bottom surface: a path on the ground, a
 *  deck, a step, a tub's water. A beam, a table, the storey above stand far
 *  higher. The same 0.2 m as a step is to a light pool (lightPlacement). */
const FLOOR_STEP_M = 0.2;
/** Two samples this close are one floor. Twice a pool's lift: closer than
 *  that, a pool could not tell them apart. */
const FLOOR_AGREE_M = 0.04;
/** Samples a room's outline is asked at: where its viewpoint stands, then,
 *  when something lies on its floor there, two more spread across it.
 *  Majority of three: one sample on a tub, a deck or a planter is outvoted. */
const OUTLINE_SAMPLES = 3;
/** A disc is asked at this many points round its centre, this far out (a
 *  share of its radius): its centre is what the asker already knows. */
const DISC_SAMPLES = 8;
const DISC_RING_AT = 0.6;

/** An area whose floor is asked: a room's outline, or the disc a light pool
 *  covers at its least reach. */
export type FloorArea = { outline: readonly Pt2[] } | { disc: { x: number; z: number; r: number } };

/**
 * Where an area is sampled, in the order asked: an outline at the point its
 * viewpoint takes (inside it even where its middle is not, geometry.pointInside),
 * then at the points of a grid inside it farthest from those already taken;
 * a disc on a ring round its centre.
 */
export function areaSamples(area: FloorArea): Pt2[] {
  if ("disc" in area) {
    const { x, z, r } = area.disc;
    return Array.from({ length: DISC_SAMPLES }, (_, k) => {
      const a = (2 * Math.PI * k) / DISC_SAMPLES;
      return { x: x + r * DISC_RING_AT * Math.cos(a), z: z + r * DISC_RING_AT * Math.sin(a) };
    });
  }
  const poly = area.outline as Pt2[];
  const b = boundsXZ(poly);
  if (!b || poly.length < 3) return [];
  let cx = 0, cz = 0, a2 = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cr = poly[j].x * poly[i].z - poly[i].x * poly[j].z;
    a2 += cr; cx += (poly[j].x + poly[i].x) * cr; cz += (poly[j].z + poly[i].z) * cr;
  }
  const centre = a2 ? { x: cx / (3 * a2), z: cz / (3 * a2) } : { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const out = [pointInside(poly, centre)];
  const grid: Pt2[] = [];
  const N = 8;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const p = { x: b.minX + ((b.maxX - b.minX) * (i + 0.5)) / N, z: b.minZ + ((b.maxZ - b.minZ) * (j + 0.5)) / N };
    // Clear of the walls: a sample on a wall line reads the wall's foot.
    if (pointInPolygon(p.x, p.z, poly) && distanceToPolygonBoundary(p.x, p.z, poly) > 0.3) grid.push(p);
  }
  while (out.length < OUTLINE_SAMPLES && grid.length) {
    let best = 0, far = -1;
    grid.forEach((p, k) => {
      const d = Math.min(...out.map((q) => Math.hypot(p.x - q.x, p.z - q.z)));
      if (d > far) { far = d; best = k; }
    });
    out.push(grid.splice(best, 1)[0]);
  }
  return out;
}

/**
 * What a point of a storey is stood on, from every surface the storey has in
 * that column (any order): the highest within FLOOR_STEP_M of its lowest.
 * `clear` when that is the lowest itself, nothing lying on it. Null when the
 * column is empty.
 */
export function standingSurface(heights: readonly number[]): { y: number; clear: boolean } | null {
  if (!heights.length) return null;
  const lowest = Math.min(...heights);
  let top = lowest;
  for (const h of heights) if (h <= lowest + FLOOR_STEP_M && h > top) top = h;
  return { y: top, clear: top - lowest <= FLOOR_AGREE_M };
}

/**
 * The floor most of an area lies on: each sample's standing surface (the
 * storey's surfaces in its column, `columnAt`), the vote's upper median, so
 * more than half the samples lie at or above it and more than half at or
 * below. Stops asking once more than half the planned samples agree. A
 * room's outline whose first sample is clear (nothing lying on its floor
 * there) is answered by it: one ray, where most rooms are. Null when no
 * sample found a surface.
 */
export function floorOfArea(area: FloorArea, columnAt: (x: number, z: number) => readonly number[]): number | null {
  const samples = areaSamples(area);
  const votes: number[] = [];
  for (const p of samples) {
    const s = standingSurface(columnAt(p.x, p.z));
    if (s === null) continue;
    if ("outline" in area && p === samples[0] && s.clear) return s.y;
    votes.push(s.y);
    if (votes.filter((v) => Math.abs(v - s.y) <= FLOOR_AGREE_M).length * 2 > samples.length) break;
  }
  if (!votes.length) return null;
  votes.sort((x, y) => x - y);
  return votes[Math.floor(votes.length / 2)];
}

/** localStorage prefix. ⚠️ BUMPED AGAIN to `vk.probe3.` in 2.474.1, for the same
 *  reason and with the same symptom: every stored answer was computed by a
 *  predicate that ACCEPTED CEILINGS as floors, so a persisted cache silently
 *  re-serves the bug the new predicate was written to fix. `airborne=26` did not
 *  move after 2.474.0 because none of those points ever re-cast a ray — they hit
 *  a stored answer from before it. **Any change to what the probe ACCEPTS is a
 *  change to what every stored answer MEANS, and must bump this.**
 *
 *  BUMPED from `vk.probe.` in 2.300.0 on purpose: those
 *  entries are keyed by the old 4m grid, and reading one as though it were
 *  room-keyed would silently reinstate the exact bug this module fixes. An old
 *  entry is never read, and is evicted by `save()`'s one-model-at-a-time sweep. */
const STORE_PREFIX = "vk.probe3.";

interface FloorProbeStats {
  probeMs: number;
  probeRays: number;
  probeHits: number;
  /** Cached answers REJECTED for sitting above the point that asked (see
   *  `below`). Non-zero means two fixtures are sharing a bucket they should not
   *  — the shape of bug that puts a light pool in mid-air — so this is a
   *  diagnosis, not a statistic. */
  probeAbove: number;
}

export class FloorProbe {
  readonly stats: FloorProbeStats = { probeMs: 0, probeRays: 0, probeHits: 0, probeAbove: 0 };
  /** The lookup map for THIS pass. `clearMemo` empties it so the same points
   *  can be re-asked under room keys once a resolver exists. */
  private cache = new Map<string, number | null>();
  /**
   * Every answer computed this session, under whichever key it was computed —
   * and the ONLY thing `save()` writes.
   *
   * These were one map until 2.346.0, and that is why the persistence had never
   * once worked. The load path runs before calibration, so `roomAt` is null and
   * every key it asks for is a GRID key; `LightPoolSet.setRooms` then calls
   * `clearMemo()` and re-probes the same points under ROOM keys. With one map,
   * the clear emptied it and the save that follows serialised only the room
   * keys — so the stored blob contained exclusively `r:` entries, while the
   * next load's `indexMeshes` asked exclusively for `g:` ones. A 100% miss
   * rate, by construction, on every load forever.
   *
   * The telemetry showed it as `probeRays: 41` and `probeMs: 889` identical on
   * a cold start and on a reload of the same GLB — 41 rays at ~21.7ms each,
   * which is 85% of `lightMs` and 63% of the whole `indexScan` block.
   *
   * Splitting the two makes `clearMemo`'s existing contract ("without dropping
   * the persisted ones") true for the first time. Reusing a stored GRID answer
   * on the load path is exactly as correct as computing one there — the load
   * path is grid-keyed today, the bytes are identical (that is what `storeKey`
   * asserts), and `LightPoolSet.setRooms` still re-probes room-keyed afterwards, so
   * the provisional answer is corrected on precisely the same schedule as
   * before. What changes is only whether a ray is cast to re-derive it.
   */
  private persisted = new Map<string, number | null>();

  /** What may answer "this is the floor". ONE definition, shared by `below`'s
   *  predicate and by `describeBelow`, so a diagnostic can never disagree with
   *  the thing it is diagnosing. */
  private readonly acceptsAsFloor = (candidate: AbstractMesh): boolean => {
    if (candidate.getTotalVertices() === 0) return false;
    if (isHelperMesh(candidate)) return false;
    const role = structureRole(candidate);
    if (!role.isStructure) return false;
    // The stamp first; the metadata flag catches a legacy GLB whose ceiling was
    // classified by name or height in applyStructure.
    return !isResolvedCeiling(candidate);
  };
  /** The localStorage half, shared with the camera beams — see modelStore.
   *  ⚠️ Prefix moved to `vk.probe3.` in 2.474.1 — see STORE_PREFIX. The sweep
   *  retires the older `vk.probe.` and `vk.probe2.` keys with it. */
  private store = new ModelKeyedStore<number | null>(STORE_PREFIX, /^vk\.probe2?\./);
  /** Injected rather than imported: only EntityVisuals holds the calibrated
   *  world-space room polygons, and it receives them AFTER the load path has
   *  already run (SceneManager calibrates post-first-frame). Returning null —
   *  which it does for the whole of that first pass — simply routes every key
   *  through the grid fallback, exactly as before.
   *
   *  ⚠️ Takes Y as well as X/Z, and that is not decoration. Storeys OVERLAP in
   *  XZ — every ground-floor point is also inside some upper-floor polygon — so
   *  an XZ-only resolver answers with whichever storey's polygon the array
   *  happened to list first. That is the 2.300.0 bug (a key that merges across a
   *  wall) reintroduced along the vertical axis: two rooms on one storey sitting
   *  under a single room of another storey resolve to ONE name and, at the same
   *  rounded fixture height, share one cached floor. */
  private roomAt: ((x: number, y: number, z: number) => string | null) | null = null;

  // A plain field, not a parameter property: Node's type stripping cannot run
  // the shorthand, and tests load this class against a real GLB.
  private scene: Scene;
  constructor(scene: Scene) { this.scene = scene; }

  setRoomResolver(fn: ((x: number, y: number, z: number) => string | null) | null): void {
    this.roomAt = fn;
  }

  /** A storey's meshes, whether or not it is shown (FloorManager in the app):
   *  what `areaFloorY` samples. Injected for the same reason as the room
   *  resolver, and none until then: an area on no known storey has no floor. */
  private storeyMeshes: ((storey: number) => readonly AbstractMesh[]) | null = null;
  setStoreyMeshes(fn: ((storey: number) => readonly AbstractMesh[]) | null): void {
    this.storeyMeshes = fn;
  }

  /**
   * Reuse the previous load's probes when the geometry is byte-identical.
   * `key` is the VERSIONED model URL, so a stale answer cannot outlive the
   * model it describes; null disables persistence entirely. Recentring and
   * scale normalisation run before this and are deterministic, so the same
   * bytes really do produce the same world positions.
   *
   * Deliberately localStorage and not IndexedDB: a few dozen short strings,
   * needed synchronously at the start of indexMeshes. Reloads are the common
   * case here — Android evicts the PWA whenever it is backgrounded, so a phone
   * pays this cost on every return to the app.
   */
  setCacheKey(key: string | null): void {
    this.store.setModel(key);
  }

  resetStats(): void {
    this.stats.probeMs = 0;
    this.stats.probeRays = 0;
    this.stats.probeHits = 0;
    this.stats.probeAbove = 0;
  }

  load(): void {
    this.cache.clear();
    this.persisted.clear();
    // The columns are this model's geometry; the next load's are its own.
    this.columns.clear();
    for (const [k, v] of this.store.load()) {
      // Into BOTH: `cache` so this pass can hit them, `persisted` so a save
      // later in this same load cannot drop what a previous load learned.
      this.cache.set(k, v);
      this.persisted.set(k, v);
    }
  }

  save(): void {
    // `persisted`, never `cache` — see that field for why writing the lookup
    // map here silently disabled this whole mechanism for as long as it
    // existed.
    this.store.save(this.persisted);
  }

  /**
   * Drop this pass's memo and re-seed it from what previous loads learned —
   * used when the room resolver arrives and the same points deserve room-keyed
   * answers.
   *
   * The RE-SEED is the point, and its absence was the second half of the same
   * bug 2.346.0 fixed. Clearing alone left every lookup missing even for keys
   * `persisted` already held, so `LightPoolSet.setRooms` re-cast its whole set of
   * room-keyed rays on every load — ~21ms each against the unoctree'd structure
   * mesh, inside `calibrateRooms`, after first paint.
   *
   * Grid entries surviving the re-seed cost nothing and cannot mislead: once a
   * resolver exists, a point inside a room is asked under an `r:` key and never
   * touches its old `g:` one, and a point inside NO polygon still resolves to
   * the grid, which is the documented fallback and the same answer it would
   * recompute. Only a ray is skipped.
   */
  clearMemo(): void {
    this.cache = new Map(this.persisted);
  }

  private bucket(x: number, y: number, z: number): string {
    const room = this.roomAt?.(x, y, z) ?? null;
    if (room !== null) return `r:${roomKey(room)}|${Math.round(y)}`;
    return `g:${Math.round(x / FALLBACK_GRID_M)}:${Math.round(y)}:${Math.round(z / FALLBACK_GRID_M)}`;
  }

  /**
   * Y of the first STRUCTURE surface directly below (x, y, z), or null if
   * nothing is within reach.
   *
   * Structure only — deliberately NOT "any solid mesh below", the same
   * restriction `blocksCameraBeam` applies to furniture for the identical
   * reason (see meshRoles.ts). Without it, a probe over a table hits the
   * FURNITURE's top surface instead of the floor beneath it — not a miss at
   * all, just the wrong answer — and the caller's marker paints at tabletop
   * height, reading as "floating" against the actual floor around it. A field
   * report traced exactly that to a dining table under a ceiling light.
   *
   * `exclude` keeps a fixture from picking itself. It is NOT part of the cache
   * key, because within one bucket the excluded mesh is the fixture doing the
   * asking and is never the floor being sought.
   */
  below(x: number, y: number, z: number, exclude?: AbstractMesh): number | null {
    const key = this.bucket(x, y, z);
    const cached = this.cache.get(key);
    this.stats.probeHits += 1;
    // ⚠️ A CACHED ANSWER MUST BE BELOW THE POINT THAT IS ASKING (2.435.0).
    //
    // A ray cast downward from `y` cannot return a hit above `y`, so a cached
    // value that IS above it did not come from this point — it came from
    // another fixture sharing this bucket, and the bucket is wrong for one of
    // them. That is not an abstract worry: the caller draws a light pool at the
    // height this returns, and a floor "above" a lamp puts a disc of light in
    // mid-air. Cheaper to notice than to debug, and it costs one comparison on
    // every hit.
    //
    // The recomputed answer is deliberately NOT written back: the bucket is
    // contested, and overwriting it would just move the wrong answer onto the
    // other fixture. It stops being a cache for this one call.
    if (cached !== undefined && (cached === null || cached <= y)) return cached;
    if (cached !== undefined) this.stats.probeAbove += 1;

    // Only a cache MISS casts a ray; probeRays vs probeHits is the bucketing's
    // real-world hit rate, which is the number that says whether a finer key
    // would help or is already exhausted.
    const t0 = performance.now();
    // ⚠️ A CEILING IS STRUCTURE, AND YOU CANNOT STAND ON IT (2.474.0).
    // `isStructureMesh` is true for a ceiling by design — it occludes and it
    // belongs to a storey, only its VISIBILITY is special — so this predicate
    // accepted one as a floor. A ceiling-mounted lamp's anchor sits AT the
    // ceiling plane, sometimes a few centimetres above a ceiling face, and a
    // downward ray from there hits that face within centimetres and reports it
    // as the floor. The light pool is then drawn at ceiling height: "the light
    // effect is floating in the air, not down to the floor", and
    // `airborne=26` in every capture of this session.
    //
    // ⚠️ It bites even for a HIDDEN storey. A custom predicate REPLACES
    // Babylon's enabled/visible filter (see this file's header), so the ~484 m²
    // of ceiling stranded in the disabled `Structure_L1` is picked exactly as
    // well as visible geometry — which is precisely where these fixtures' rays
    // were landing.
    //
    // Free: `structureRole` is resolved ONCE here and both facts read off it,
    // where the old line called `isStructureMesh` (which resolves the same
    // role) and then knew nothing about ceilings. Strictly fewer candidates,
    // so if anything the ray gets cheaper.
    const predicate = (candidate: AbstractMesh) =>
      candidate !== exclude && this.acceptsAsFloor(candidate);
    const cast = (px: number, pz: number): number | null => {
      this.stats.probeRays += 1;
      const hit = this.scene.pickWithRay(
        new Ray(new Vector3(px, y, pz), Vector3.Down(), PROBE_REACH_M), predicate,
      );
      return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : null;
    };
    let result = cast(x, z);
    if (result === null) {
      for (const [dx, dz] of [
        [SEAM_NUDGE_M, 0], [-SEAM_NUDGE_M, 0], [0, SEAM_NUDGE_M], [0, -SEAM_NUDGE_M],
      ]) {
        result = cast(x + dx, z + dz);
        if (result !== null) break;
      }
    }
    this.stats.probeMs += performance.now() - t0;
    // Only a bucket nobody has contested may be stored — see the guard above.
    if (cached === undefined) {
      this.cache.set(key, result);
      this.persisted.set(key, result);
    }
    return result;
  }

  /**
   * The floor height of a specific STOREY at (x, z), 0 if that storey has no
   * geometry there.
   *
   * A different question from `below()` and it keeps its own implementation on
   * purpose: it is scoped to ONE storey's meshes (FloorManager hides all the
   * others, and the answer must not depend on which happened to be showing),
   * and it takes the LOWEST of all hits rather than the first, because a room's
   * ceiling belongs to the same storey mesh as its floor. Both come from the
   * predicate, which is also why no visibility juggling is needed — see below.
   *
   * MEMOISED since 2.352.0, and persisted with everything else here. It was
   * not, on the grounds that the enable/restore dance makes a shared key
   * meaningless across different `meshes` sets — true of the MESHES, but the
   * answer only ever depends on (storey, x, z), and `storey` is now passed in
   * precisely so it can be part of the key. It was measured at 387-423ms over
   * 24 calls, which after the rest of this session's work is essentially the
   * whole of what `calibrateRooms` still costs.
   *
   * Quantised to millimetres for the same reason the teleport points are (see
   * TeleportPoint's mm() note): these coordinates are room centroids through a
   * re-solved affine fit, so they reproduce to within a ULP on the same
   * geometry but not bit-identically. A millimetre is far below anything a
   * floor height can express and far above that noise.
   */
  /**
   * A FRESH, uncached probe that also says WHAT it hit.
   *
   * ⚠️ Exists because a COUNT is not a diagnosis, and `airborne=26` has now
   * survived two fixes aimed at causes I inferred rather than observed. The
   * pattern that actually worked on the ceiling was per-object attribution, so
   * this names the mesh under each floating pool instead of tallying them.
   *
   * Deliberately bypasses both maps: a cached answer is exactly what must not
   * be trusted here, and the whole point is to see what a ray finds today.
   * ⚠️ NOT debug-only (this said it was): lightPlacement asks it for every pool
   * that lands within half a metre of its own fixture, to tell a ceiling hit
   * from a genuinely low-mounted light. It is a full pick against the
   * unoctree'd structure (~21 ms), so keep that the only production caller.
   */
  describeBelow(x: number, y: number, z: number): { y: number; what: string } | null {
    const hit = this.scene.pickWithRay(
      new Ray(new Vector3(x, y, z), Vector3.Down(), PROBE_REACH_M),
      this.acceptsAsFloor,
    );
    if (!hit?.hit || !hit.pickedPoint) return null;
    return { y: hit.pickedPoint.y, what: hit.pickedMesh?.name ?? "?" };
  }

  /**
   * THE FLOOR MOST OF AN AREA LIES ON, on one storey: a room's outline (its
   * highlight, its viewpoint, every reader of the plan) or the disc a light
   * pool covers (lightPlacement). Sampled inside the area, a majority vote
   * (floorOfArea), cached by the area and kept with every other answer here.
   * Null when no sample found a surface.
   *
   * ⚠️ ONE RULE FOR A POINT, WHERE THERE WERE TWO (2026-11-20). A room read
   * its floor as the LOWEST of its storey's surfaces under one point inside
   * it; a pool raised a little above its room's floor asked eight points
   * round it for the FIRST structure under its fixture. Each rule is wrong
   * for the other's case, which is why each existed:
   *   * the lowest misses what lies on the slab: under the entrance light the
   *     path is 6 cm up on the ground, and the ground under it is lowest,
   *     so the pool would sink off the path;
   *   * the first from above meets whatever overhangs the point: a beam over
   *     a bathroom's middle, a terrace's roof, and on a model whose
   *     structure is one mesh for every storey, the storey above itself.
   * So a point is stood on the highest of its storey's surfaces within
   * FLOOR_STEP_M of the lowest (standingSurface): the path, a deck, a step
   * or a tub's water, never a beam, a roof or a floor above. And where
   * something lies on the floor, one point is not the area's answer: the
   * onsen pool read the one point under its lamp (the tub's water), a room
   * whose viewpoint falls on a deck or a tub would read that. The vote over
   * the area is what both now share; a staircase's viewpoint stands on one
   * tread, nothing on it, and keeps it (a vote across its treads would land
   * on the lowest).
   *
   * Cost: one pick per sample, the same ~21 ms pick as `storeyFloorY`, and
   * every area's answer cached and persisted: a room pays one ray, as before,
   * unless something lies on its floor at its viewpoint (then three, once
   * per model on a device); a pool pays only when it is raised a little
   * above its room's floor (placeLight), once, where its ring of rays was
   * cast again on every placement pass.
   */
  areaFloorY(area: FloorArea, storey: number): number | null {
    const meshes = this.storeyMeshes?.(storey) ?? [];
    if (!meshes.length) return null;
    const q = (v: number) => Math.round(v * 1000);
    const key = "disc" in area
      ? `ad:${storey}:${q(area.disc.x)}:${q(area.disc.z)}:${q(area.disc.r)}`
      : `ao:${storey}:${area.outline.map((p) => `${q(p.x)},${q(p.z)}`).join(" ")}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    // A SET, for the reason spelled out in `storeyFloorY`. The storey's
    // structure (`acceptsAsFloor`): what a light lands on and what a room
    // stands on are structure, a table is not. A model that marks no
    // structure on the storey has only its meshes to stand on, ceilings aside.
    const structure = meshes.filter(this.acceptsAsFloor);
    const wanted = new Set(structure.length ? structure : meshes.filter((m) => !isResolvedCeiling(m)));
    const result = floorOfArea(area, (x, z) => this.columnAt(wanted, storey, x, z));
    this.cache.set(key, result);
    this.persisted.set(key, result);
    return result;
  }

  /** Every surface of a storey's meshes under (x, z), cached by point for
   *  this session (a room and a pool beside it share samples; the AREA's
   *  answer is what is kept across loads). */
  private columns = new Map<string, number[]>();
  private columnAt(meshes: ReadonlySet<AbstractMesh>, storey: number, x: number, z: number): number[] {
    const key = `${storey}:${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
    const cached = this.columns.get(key);
    if (cached) return cached;
    const t0 = performance.now();
    // World Y is metres after normalisation; ±1000 comfortably brackets any villa.
    const hits = this.scene.multiPickWithRay(
      new Ray(new Vector3(x, 1000, z), Vector3.Down(), 2000),
      (m) => meshes.has(m),
    );
    this.stats.probeMs += performance.now() - t0;
    this.stats.probeRays += 1;
    const column = (hits ?? []).flatMap((h) => (h.pickedPoint ? [h.pickedPoint.y] : []));
    this.columns.set(key, column);
    return column;
  }

  storeyFloorY(meshes: AbstractMesh[], x: number, z: number, storey: number): number {
    if (!meshes.length) return 0;
    const key = `s:${storey}:${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && cached !== null) return cached;
    const t0 = performance.now();
    // ⚠️ NO enable/restore dance, and its removal is a correction, not a risk.
    //
    // This used to force-show every mesh of the requested storey and put them
    // back afterwards, on the stated grounds that "Babylon's picking skips
    // setEnabled(false) meshes and FloorManager hides every storey except the
    // one being viewed". That is true only of the DEFAULT predicate. Both
    // `InternalPick` and `InternalMultiPick` read:
    //
    //     if (predicate) { if (!predicate(mesh, -1)) continue; }
    //     else if (!mesh.isEnabled() || !mesh.isVisible || !mesh.isPickable) continue;
    //
    // — an `else if`. A custom predicate REPLACES that filter outright, and
    // every caller here passes one, so the visibility of the storey never
    // entered into the answer. The dance mutated a few hundred meshes twice per
    // call for nothing, and left a window in which any rendered frame would
    // have drawn hidden storeys. That window is also what made the stair-glow
    // conform "impossible to chunk" — removing this is what unblocked it.
    //
    // A SET, not `meshes.includes(m)`. The predicate is called once per mesh in
    // the scene and the array scan inside it made the whole test quadratic in
    // the storey's mesh count — on a villa whose structure is one fused mesh
    // per storey that is invisible, but on a furnished storey it is hundreds
    // squared, per room, per calibration. Identical semantics, so this cannot
    // change which floor is found; only what it costs to find it.
    const wanted = new Set(meshes);
    // World Y is metres after normalisation; ±1000 comfortably brackets any villa.
    const hits = this.scene.multiPickWithRay(
      new Ray(new Vector3(x, 1000, z), Vector3.Down(), 2000),
      // ⚠️ NEVER A CEILING, for the same reason as `below()`'s predicate
      // (2.474.0): a storey's ceiling is in that storey's mesh set, so a ray
      // dropped from 1000 m hits it long before the floor and this would answer
      // "the floor of storey N is at ceiling height". Every consumer wants the
      // surface you STAND on — camera framing, and
      // the first-person spawn's standability test.
      (m) => wanted.has(m) && !isResolvedCeiling(m),
    );
    // Counted alongside the `below()` rays: this is the same ~21ms pick against
    // the same unoctree'd structure, and splitting it into a second statistic
    // would only hide that.
    this.stats.probeMs += performance.now() - t0;
    this.stats.probeRays += 1;
    let lowestY = Infinity;
    if (hits) for (const h of hits) if (h.pickedPoint && h.pickedPoint.y < lowestY) lowestY = h.pickedPoint.y;
    const result = Number.isFinite(lowestY) ? lowestY : 0;
    // A storey with no geometry at (x,z) legitimately answers 0, and caching
    // that is correct — it is an answer, not a miss.
    this.cache.set(key, result);
    this.persisted.set(key, result);
    return result;
  }

  /**
   * The renderable surface under (x, z), as a full pick — the caller wants the
   * MESH and its normal, not a height, because it is projecting a decal onto
   * whatever is really there. Deliberately NOT the structure-only predicate the
   * other two use: a decal draping over a staircase should land on the stair
   * asset, furniture or not; it only excludes the app's own markers.
   *
   * ⚠️ …AND CEILINGS (2.478.0, found by /dry-audit). The exemption above is
   * about FURNITURE — "land on the stair asset, furniture or not" — and a
   * ceiling is neither furniture nor something a floor decal may land on. Its
   * one caller probes from `floorY + DECAL_PROBE_ABOVE`, which is 3 m, and this
   * villa's ceilings sit at 2.44 m: the ray therefore STARTS ABOVE THE CEILING
   * and hits it first, so every ground-floor room glow would drape on the
   * ceiling's underside instead of the floor.
   *
   * Not a latent risk — a live one as of this session, because until the peel
   * was fixed there was almost no ceiling geometry for it to hit. The bug was
   * created by making something else work, which is exactly the shape an audit
   * of the APPLICABLE SET catches and an audit of call sites does not.
   */
  surfaceUnder(x: number, z: number, fromY: number, depth: number): PickingInfo | null {
    const hit = this.scene.pickWithRay(
      new Ray(new Vector3(x, fromY, z), Vector3.Down(), depth),
      rayTargets({ enabled: false }),
    );
    return hit?.hit && hit.pickedMesh && hit.pickedPoint ? hit : null;
  }
}
