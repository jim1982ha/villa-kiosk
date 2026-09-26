// src/babylon/fanRigs.ts
// Ceiling fans that SPIN: which fan entities spin, the rig that turns one in
// place around its true axle, the badge anchor lifted out of the spinning
// subtree, the per-frame turn, and the teardown — one module.
//
// ⚠️ IT WAS SEVEN FIELDS AND FOUR METHODS OF EntityVisuals, WITH TWO TEARDOWNS
// THAT DISAGREED. The re-index path moved each fan mesh back out of its pivot
// before disposing it (a TransformNode's dispose is RECURSIVE, and disposing
// the pivot outright had destroyed the fan mesh on every re-index after it had
// spun); the full-dispose path disposed the pivots outright and left the spin
// angles behind. `clear` is the one path now.
//
// tests/oracles/fan_rigs.mjs drives it on a NullEngine.

import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { HassEntity } from "@/types/ha.types";

// Ceiling-fan spin: angular speed (rad/s) at full fan percentage. A whole-mesh
// spin reads as "blades turning" at kiosk distance; ~1 rev/s is lively without
// strobing. Scaled down by the fan's percentage (min 15%) when reported.
const FAN_MAX_RAD_PER_SEC = 6.2;
// A ceiling fan is exported as ONE fused mesh (mount + motor + blades all one
// piece, one material — no separate "blade" sub-object to isolate), so the
// whole thing has to spin together; see updateFanSpin/computeFanSpin. The top
// fraction of its height (the ceiling mount/canopy) is reliably the one part
// that's round and centred exactly on the true axle, so its own vertices —
// not the whole mesh's bounding box — decide WHERE that axle sits. Get this
// right and the mount+pole (rotationally symmetric) reads as motionless even
// though it's technically rotating with the blades; get it wrong (the old
// plain bbox-midpoint) and the pole visibly orbits in a small circle instead
// of spinning in place.
const FAN_AXIS_TOP_SLICE = 0.25;

/**
 * Does this fan entity SPIN on the map? Only a CEILING fan does — a VMC or a
 * bathroom extractor is a `fan.*` too, and must not turn. Read from the
 * entity id because Home Assistant has no device_class for a fan's KIND.
 *
 * ⚠️ Unanchored on purpose, and safe only because the caller gates on the
 * mapping's `fan` type — without it this would match `light.x_ceiling_fan_light`
 * and spin a lamp. /dry-audit re-flags this shape (the documented trap is
 * `door` matching inside `outdoor`); anchoring to (^|[._])…([._]|$) would
 * not change the verdict for any realistic id, since the ambiguous cases
 * (`fan.bathroom_ceiling_fan`, a ceiling-mounted extractor) match either way.
 */
export function isCeilingFan(entityId: string): boolean {
  return /ceiling[_-]?fan/i.test(entityId);
}

/** One mesh of a fan, reparented under a pivot at its true axle. */
export interface FanRig { mesh: AbstractMesh; pivot: TransformNode; axisLocal: Vector3 }

export class FanRigs {
  private readonly scene: Scene;
  private readonly anchorOf: (entityId: string) => TransformNode | undefined;
  private readonly wake: () => void;
  /** entity_id → angular speed (rad/s) for a CEILING fan currently spinning. */
  private readonly spinning = new Map<string, number>();
  /** entity_id → total accumulated spin angle (radians, wrapped to 2π) — the
   *  rotation is recomputed FRESH from this absolute angle every frame (never
   *  accumulated incrementally), so there is no possible drift. */
  private readonly angles = new Map<string, number>();
  /** entity_id → per-mesh spin rig, set up once (lazily, on first "on") via
   *  setupFanRig: `pivot` is an invisible TransformNode sitting at the mesh's
   *  own true axle (see setupFanRig) that the mesh got REPARENTED under —
   *  animateFans only ever rotates `pivot`, never the mesh's own transform,
   *  so the mesh's local bounding info / pivot matrix (which the badge's
   *  linkWithMesh tracking reads) stay exactly what they always were. */
  private readonly rigs = new Map<string, FanRig[]>();

  constructor(scene: Scene, anchorOf: (entityId: string) => TransformNode | undefined, wake: () => void) {
    this.scene = scene;
    this.anchorOf = anchorOf;
    this.wake = wake;
  }

  /** How many fans are turning. */
  get spinningCount(): number { return this.spinning.size; }

  /** Start/stop a fan's spin from its on/off (+ percentage) state. Only true
   *  CEILING fans spin (isCeilingFan). */
  /** Start/stop a fan's spin from its on/off (+ percentage) state. Only true
   *  CEILING fans spin — VMC/exhaust `fan.*` entities (bathroom vents) must not. */
  show(entity: HassEntity, meshes: readonly AbstractMesh[]): void {
    const id = entity.entity_id;
    if (!isCeilingFan(id)) return;
    if (entity.state === "on") {
      const pct = entity.attributes.percentage as number | undefined;
      const frac = typeof pct === "number" ? Math.max(0.15, Math.min(1, pct / 100)) : 0.6;
      if (!this.rigs.has(id)) {
        const rig = this.setupFanRig(meshes);
        this.rigs.set(id, rig);
        this.detachLabelAnchor(id, rig);
      }
      this.spinning.set(id, FAN_MAX_RAD_PER_SEC * frac);
      this.wake(); // wake the loop so animate starts turning it
    } else {
      this.spinning.delete(id);
    }
  }

  /**
   * Rig each of the fan's meshes to spin in place around its TRUE axle.
   *
   * Two earlier approaches both broke on this exact mesh shape:
   *  - `rotateAround` re-derives its pivot offset from the mesh's CURRENT
   *    `.position` every call (`point - this.position`), so it only spins in
   *    place when the pivot is *exactly* that position. These fan meshes
   *    import with `.position` at the parent-local origin (0,0,0) — the real
   *    placement is baked entirely into vertex data — so any vertex-derived
   *    pivot orbited the whole mesh (and, since the label anchors to that
   *    same mesh, the label with it).
   *  - `mesh.setPivotPoint()` fixes the orbit mathematically (verified by
   *    hand), but the badge's position tracking (Babylon GUI's
   *    `linkWithMesh`) projects the mesh's *local* bounding-sphere centre
   *    through `getWorldMatrix()` each frame — an interaction with the pivot
   *    matrix I could not fully rule out without a browser, and empirically
   *    it made the fan (mesh AND label) disappear on "on" and never return.
   *
   * This version touches neither: an invisible `TransformNode` ("pivot") is
   * planted at the mesh's true axle and the mesh is REPARENTED under it
   * (`setParent` — a mechanism already used everywhere else in this app —
   * adjusts the mesh's local position/rotation to compensate, so nothing
   * visually moves at the moment of reparenting). Only `pivot.rotationQuaternion`
   * is ever touched afterwards; the mesh's OWN transform, pivot matrix and
   * bounding info stay exactly what they always were, so the badge (and
   * everything else that reads the mesh directly) can't be affected.
   *
   * The axle itself: average the vertices in the TOP slice of the fixture —
   * along whichever LOCAL axis currently reads as world-vertical, see
   * FAN_AXIS_TOP_SLICE — since the ceiling mount/canopy is reliably round and
   * centred exactly on the true axle, unlike the whole fixture's bounding box
   * (which assumes the blade assembly is perfectly symmetric; it usually
   * isn't quite).
   */
  private setupFanRig(
    meshes: readonly AbstractMesh[],
  ): FanRig[] {
    const rig: FanRig[] = [];
    for (const m of meshes) {
      const positions = m.getVerticesData(VertexBuffer.PositionKind);
      if (!positions || positions.length < 3) continue;
      m.computeWorldMatrix(true);

      // The LOCAL (pre-rotation) direction that currently reads as
      // world-vertical — NOT necessarily local Y: these fixtures import with
      // a baked axis-conversion rotation (SweetHome's Z-up -> glTF's Y-up),
      // so the mesh's own un-rotated vertex data has "up" on a different
      // axis. Deriving it (rather than assuming Y or Z) keeps this correct
      // regardless of how any given model happens to be authored/exported.
      const invWorld = Matrix.Invert(m.getWorldMatrix());
      const axisInMeshSpace = Vector3.TransformNormal(Vector3.Up(), invWorld);
      axisInMeshSpace.normalize();

      // Project every vertex onto that axis to find the fixture's "height"
      // range, then average the positions in its top slice — in the mesh's
      // OWN local/object space, the same space getVerticesData returns, so
      // no world-matrix round-trip is needed for this part.
      const v = Vector3.Zero();
      let hMin = Infinity, hMax = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i], positions[i + 1], positions[i + 2]);
        const h = Vector3.Dot(v, axisInMeshSpace);
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
      const topThreshold = hMax - (hMax - hMin) * FAN_AXIS_TOP_SLICE;
      const sum = Vector3.Zero();
      let sampled = 0;
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i], positions[i + 1], positions[i + 2]);
        if (Vector3.Dot(v, axisInMeshSpace) >= topThreshold) { sum.addInPlace(v); sampled++; }
      }
      // Fall back to the plain local bbox midpoint if the top slice somehow
      // caught too little geometry to average reliably (e.g. a sparse mount).
      const bb = m.getBoundingInfo().boundingBox;
      const axleLocal = sampled >= 20 ? sum.scale(1 / sampled) : bb.minimum.add(bb.maximum).scale(0.5);
      if (!Number.isFinite(axleLocal.x) || !Number.isFinite(axleLocal.y) || !Number.isFinite(axleLocal.z)) continue;

      const axleWorld = Vector3.TransformCoordinates(axleLocal, m.getWorldMatrix());
      const parent = m.parent;
      const parentWorld = parent?.getWorldMatrix?.();
      const pivot = new TransformNode(`fanPivot_${m.uniqueId}`, this.scene);
      pivot.parent = parent;
      pivot.position = parentWorld
        ? Vector3.TransformCoordinates(axleWorld, Matrix.Invert(parentWorld))
        : axleWorld;

      // Reparent the mesh under the pivot — setParent adjusts the mesh's own
      // local position/rotation so its WORLD transform (and therefore its
      // on-screen appearance) is unchanged by this move.
      m.setParent(pivot);

      // The axis the PIVOT itself rotates around, in ITS parent's local space
      // (the shared original parent — pivot has no rotation of its own
      // besides the spin animateFans applies, so this is just world-up
      // projected through that parent's own orientation).
      const axisLocal = parentWorld
        ? Vector3.TransformNormal(Vector3.Up(), Matrix.Invert(parentWorld)).normalize()
        : Vector3.Up();

      rig.push({ mesh: m, pivot, axisLocal });
    }
    return rig;
  }

  /**
   * The label anchor is parented to the entity's first mesh (see
   * buildLabelAnchors — it inherits enabled/floor state that way), which is
   * exactly why the badge was STILL orbiting after 2.23.1's mesh-pivot fix:
   * `setupFanRig` reparents that same mesh under the spin `pivot`, so the
   * anchor — a grandchild of `pivot` via the mesh — got dragged into the
   * rotating subtree too, even though the mesh's own transform relative to
   * its new parent never changes. Move it back OUT, onto the pivot's own
   * (non-rotating) parent — `setParent` preserves its current world
   * position, so the badge stays exactly where it already was, just no
   * longer inside anything that spins.
   *
   * This intentionally breaks the anchor's OWN parent chain as a source of
   * floor enabled-state/floorIndex (the pivot's parent is a shared container
   * FloorManager never touches) — cullLabels() compensates by reading those
   * straight off the entity's bound mesh instead of the anchor's parent, so
   * the fan's badge still correctly disappears on the other floor.
   */
  private detachLabelAnchor(
    entityId: string,
    rig: FanRig[],
  ): void {
    const anchor = this.anchorOf(entityId);
    const primary = rig[0];
    if (!anchor || !primary || anchor.parent !== primary.mesh) return;
    anchor.setParent(primary.pivot.parent);
  }

  /** One frame: advance every spinning fan on a shown storey. Returns whether
   *  any turned — the caller keeps the loop rendering while they do. */
  animate(dtMs: number, activeFloor: number): boolean {
    if (this.spinning.size === 0) return false;
    const dt = dtMs / 1000;
    let spun = false;
    for (const [id, speed] of this.spinning) {
      const rig = this.rigs.get(id);
      if (!rig || !rig.length) continue;
      // Only spin (and keep rendering) while the fan's storey is being viewed —
      // floors above the active one are hidden, so their fans needn't drive
      // continuous frames. (Cumulative floors: <= active are visible.)
      const floorIdx = (rig[0].mesh.metadata as { floorIndex?: number } | null)?.floorIndex;
      if (floorIdx !== undefined && floorIdx > activeFloor) continue;

      // The TOTAL angle, wrapped — every frame recomputes rotation fresh from
      // this absolute value (never accumulated), so there is nothing for
      // floating-point error to drift.
      const angle = ((this.angles.get(id) ?? 0) + speed * dt) % (Math.PI * 2);
      this.angles.set(id, angle);
      for (const { pivot, axisLocal } of rig) {
        // Write THROUGH the existing quaternion rather than replacing it: a
        // ceiling fan left on is the normal state in a villa, and this runs
        // every frame forever for each of its blade rigs (animateFans re-arms
        // the render loop below), so allocating one per rig per frame is a
        // permanent garbage stream. Created once on first use.
        if (!pivot.rotationQuaternion) {
          pivot.rotationQuaternion = Quaternion.RotationAxis(axisLocal, angle);
        } else {
          Quaternion.RotationAxisToRef(axisLocal, angle, pivot.rotationQuaternion);
        }
      }
      spun = true;
    }
    return spun;
  }

  /**
   * Unrig every fan — the ONE teardown. TransformNode.dispose() with no args
   * is RECURSIVE: each fan mesh is a child of its pivot, so disposing the
   * pivot outright destroyed the fan mesh itself on every structural re-index
   * after it had ever spun (any Advanced Settings edit touching entityMap).
   * The mesh moves back out onto the pivot's original parent FIRST — the same
   * world-preserving setParent used to rig it — and only the childless pivot
   * is disposed.
   */
  clear(): void {
    for (const rig of this.rigs.values()) {
      for (const r of rig) {
        if (!r.mesh.isDisposed()) r.mesh.setParent(r.pivot.parent);
        r.pivot.dispose();
      }
    }
    this.rigs.clear();
    this.angles.clear();
    this.spinning.clear();
  }
}
