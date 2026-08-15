// src/babylon/floorProbe.ts
//
// "What is the floor height here?" — asked from three places, answered three
// different ways until 2.300.0, and one of those ways was the cause of a real
// field bug (a light pool buried under the walkway it was meant to light).
//
//   EntityVisuals.surfaceBelow   light pools + label/strip drops
//   SceneManager.estimateFloorY  room glow, teleport points, camera framing
//   RoomHighlight.buildDecal     the surface a point-room glow drapes over
//
// They are not the same question and this module does not pretend they are —
// the first wants the structure below a fixture, the second wants a STOREY's
// floor with hidden storeys temporarily made pickable, the third wants the
// picked mesh and its normal, not a height. What they share, and what was
// duplicated three ways, is the downward ray, the "structure only, never
// furniture" predicate, the seam-nudge retry, and the memoisation. That is
// what lives here.
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
// that has not reached calibration yet — see EntityVisuals.reshapeLightPools).

import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { PickingInfo } from "@babylonjs/core/Collisions/pickingInfo";
import type { Scene } from "@babylonjs/core/scene";

import { roomKey } from "@/config/roomKey";
import { isStructureMesh } from "./meshRoles";

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

/** localStorage prefix. BUMPED from `vk.probe.` in 2.300.0 on purpose: those
 *  entries are keyed by the old 4m grid, and reading one as though it were
 *  room-keyed would silently reinstate the exact bug this module fixes. An old
 *  entry is never read, and is evicted by `save()`'s one-model-at-a-time sweep. */
const STORE_PREFIX = "vk.probe2.";

export interface FloorProbeStats {
  probeMs: number;
  probeRays: number;
  probeHits: number;
}

export class FloorProbe {
  readonly stats: FloorProbeStats = { probeMs: 0, probeRays: 0, probeHits: 0 };
  /** The lookup map for THIS pass. `clearMemo` empties it so the same points
   *  can be re-asked under room keys once a resolver exists. */
  private cache = new Map<string, number | null>();
  /**
   * Every answer computed this session, under whichever key it was computed —
   * and the ONLY thing `save()` writes.
   *
   * These were one map until 2.346.0, and that is why the persistence had never
   * once worked. The load path runs before calibration, so `roomAt` is null and
   * every key it asks for is a GRID key; `reshapeLightPools` then calls
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
   * asserts), and `reshapeLightPools` still re-probes room-keyed afterwards, so
   * the provisional answer is corrected on precisely the same schedule as
   * before. What changes is only whether a ray is cast to re-derive it.
   */
  private persisted = new Map<string, number | null>();
  private storeKey: string | null = null;
  /** Injected rather than imported: only EntityVisuals holds the calibrated
   *  world-space room polygons, and it receives them AFTER the load path has
   *  already run (SceneManager calibrates post-first-frame). Returning null —
   *  which it does for the whole of that first pass — simply routes every key
   *  through the grid fallback, exactly as before. */
  private roomAt: ((x: number, z: number) => string | null) | null = null;

  constructor(private scene: Scene) {}

  setRoomResolver(fn: ((x: number, z: number) => string | null) | null): void {
    this.roomAt = fn;
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
    this.storeKey = key ? `${STORE_PREFIX}${key}` : null;
  }

  resetStats(): void {
    this.stats.probeMs = 0;
    this.stats.probeRays = 0;
    this.stats.probeHits = 0;
  }

  load(): void {
    this.cache.clear();
    this.persisted.clear();
    if (!this.storeKey) return;
    try {
      const raw = localStorage.getItem(this.storeKey);
      if (!raw) return;
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, number | null>)) {
        // Into BOTH: `cache` so this pass can hit them, `persisted` so a save
        // later in this same load cannot drop what a previous load learned.
        this.cache.set(k, v);
        this.persisted.set(k, v);
      }
    } catch { /* unreadable or quota-evicted — just re-probe */ }
  }

  save(): void {
    if (!this.storeKey) return;
    try {
      // One model's probes at a time: an older GLB's entries are dead weight
      // the moment a new one is uploaded, and this runs on devices where
      // storage pressure is real. Sweeps the retired `vk.probe.` prefix too.
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i);
        if (k && /^vk\.probe2?\./.test(k) && k !== this.storeKey) localStorage.removeItem(k);
      }
      // `persisted`, never `cache` — see that field for why writing the lookup
      // map here silently disabled this whole mechanism for as long as it
      // existed.
      localStorage.setItem(this.storeKey, JSON.stringify(Object.fromEntries(this.persisted)));
    } catch { /* quota / private mode — the cache is an optimisation, not state */ }
  }

  /** Drop memoised answers without dropping the persisted ones — used when the
   *  room resolver arrives and the same points deserve room-keyed answers.
   *  The second half of that sentence only became true in 2.346.0. */
  clearMemo(): void {
    this.cache.clear();
  }

  private bucket(x: number, y: number, z: number): string {
    const room = this.roomAt?.(x, z) ?? null;
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
    if (cached !== undefined) return cached;

    // Only a cache MISS casts a ray; probeRays vs probeHits is the bucketing's
    // real-world hit rate, which is the number that says whether a finer key
    // would help or is already exhausted.
    const t0 = performance.now();
    const predicate = (candidate: AbstractMesh) =>
      candidate !== exclude && candidate.getTotalVertices() > 0
      && !/^(halo_|label_|marker)/i.test(candidate.name)
      && isStructureMesh(candidate);
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
    this.cache.set(key, result);
    this.persisted.set(key, result);
    return result;
  }

  /**
   * The floor height of a specific STOREY at (x, z), 0 if that storey has no
   * geometry there.
   *
   * A different question from `below()` and it keeps its own implementation on
   * purpose. Babylon's picking skips `setEnabled(false)` meshes and
   * FloorManager hides every storey except the one being viewed, so this has to
   * make the requested storey pickable for the duration and put it back
   * afterwards — otherwise the answer depends on whatever floor happened to be
   * active when it was asked. It also takes the LOWEST of all hits rather than
   * the first, because a room's ceiling belongs to the same storey mesh as its
   * floor.
   *
   * Not memoised: it is called a few dozen times per calibration, from above
   * the villa, and the enable/restore dance makes a shared cache key
   * meaningless across different `meshes` sets.
   */
  storeyFloorY(meshes: AbstractMesh[], x: number, z: number): number {
    if (!meshes.length) return 0;
    const saved = meshes.map((m) => [m.isEnabled(false), m.isPickable] as const);
    for (const m of meshes) { m.setEnabled(true); m.isPickable = true; }
    // World Y is metres after normalisation; ±1000 comfortably brackets any villa.
    const hits = this.scene.multiPickWithRay(
      new Ray(new Vector3(x, 1000, z), Vector3.Down(), 2000),
      (m) => meshes.includes(m),
    );
    meshes.forEach((m, i) => { m.setEnabled(saved[i][0]); m.isPickable = saved[i][1]; });
    if (!hits?.length) return 0;
    let lowestY = Infinity;
    for (const h of hits) if (h.pickedPoint && h.pickedPoint.y < lowestY) lowestY = h.pickedPoint.y;
    return Number.isFinite(lowestY) ? lowestY : 0;
  }

  /**
   * The renderable surface under (x, z), as a full pick — the caller wants the
   * MESH and its normal, not a height, because it is projecting a decal onto
   * whatever is really there. Deliberately NOT the structure-only predicate the
   * other two use: a decal draping over a staircase should land on the stair
   * asset, furniture or not; it only excludes the app's own markers.
   */
  surfaceUnder(x: number, z: number, fromY: number, depth: number): PickingInfo | null {
    const hit = this.scene.pickWithRay(
      new Ray(new Vector3(x, fromY, z), Vector3.Down(), depth),
      (m) => m.isPickable && m.isVisible && !m.metadata?.isMarker,
    );
    return hit?.hit && hit.pickedMesh && hit.pickedPoint ? hit : null;
  }
}
