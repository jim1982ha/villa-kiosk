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
import { isRenderedFloor, stampedFloor } from "./floorOf";

// Ceiling-fan spin: angular speed (rad/s) at full fan percentage. A whole-mesh
// spin reads as "blades turning" at kiosk distance; ~1 rev/s is lively without
// strobing. Scaled down by the fan's percentage (min 15%) when reported.
const FAN_MAX_RAD_PER_SEC = 6.2;
// A ceiling fan is exported as ONE fused mesh (mount + motor + blades all one
// piece, one material — no separate "blade" sub-object to isolate), so the
// whole thing has to spin together. WHERE its axle sits is the centre of the
// smallest circle holding the whole fixture seen from above: the circle its
// blade tips draw, whatever else it carries (enclosingCircle). Get it wrong
// and the blades visibly swing round the hub instead of turning in place.
//
// ⚠️ IT WAS THE AVERAGE OF THE FIXTURE'S TOP QUARTER (owner, 2026-11-04, a
// recording: "before it was perfectly ok, with only the blades to turn"). That
// assumed a round ceiling mount on top; a model exporting a fan as its flat
// blades alone (the hub a separate light) has no mount, its top quarter is a
// lopsided part of the blades, and the axle landed 9 cm off: the blades swung
// 18 cm round the hub. Measured on the villa's own model, the circle's centre
// is within 2 cm of the point each fan is most symmetric about, with or
// without its mount; the plain bounding box's middle is up to 21 cm off (three
// blades are not a square).

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

/**
 * The smallest circle holding every point (Welzl's algorithm, its expected
 * linear time from a shuffled order; the shuffle is a fixed one, so a fixture
 * rigs alike on every load). Null for no point.
 */
export function enclosingCircle(points: readonly (readonly [number, number])[]): { x: number; y: number; r: number } | null {
  if (points.length === 0) return null;
  const p = points.slice();
  for (let i = p.length - 1; i > 0; i--) {
    const j = (i * 7919) % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  type C = { x: number; y: number; r: number };
  const holds = (c: C, q: readonly [number, number]) => Math.hypot(q[0] - c.x, q[1] - c.y) <= c.r * (1 + 1e-9) + 1e-9;
  const two = (a: readonly [number, number], b: readonly [number, number]): C =>
    ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 });
  const three = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): C | null => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) return null;
    const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
    const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
    const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
  };
  let c: C = { x: p[0][0], y: p[0][1], r: 0 };
  for (let i = 1; i < p.length; i++) {
    if (holds(c, p[i])) continue;
    c = { x: p[i][0], y: p[i][1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (holds(c, p[j])) continue;
      c = two(p[i], p[j]);
      for (let k = 0; k < j; k++) if (!holds(c, p[k])) c = three(p[i], p[j], p[k]) ?? c;
    }
  }
  return c;
}

/** One mesh of a fan, reparented under a pivot at its true axle. */
interface FanRig { mesh: AbstractMesh; pivot: TransformNode; axisLocal: Vector3 }

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
   * The axle itself: the centre of the smallest circle holding every vertex,
   * seen from above (enclosingCircle) — the circle the blade tips draw — at
   * the fixture's mid height (a vertical axle: any height on it turns alike).
   */
  private setupFanRig(
    meshes: readonly AbstractMesh[],
  ): FanRig[] {
    const rig: FanRig[] = [];
    for (const m of meshes) {
      const positions = m.getVerticesData(VertexBuffer.PositionKind);
      if (!positions || positions.length < 3) continue;
      // This mesh is about to spin: SceneManager froze every GLB mesh's
      // world matrix after load (nothing else moves one).
      m.unfreezeWorldMatrix();
      m.computeWorldMatrix(true);

      // Every vertex seen from above, in the WORLD (these fixtures import
      // with a baked axis-conversion rotation, so the mesh's own data has
      // "up" on another axis; the world's is Y).
      const wm = m.getWorldMatrix();
      const v = Vector3.Zero();
      const flat: [number, number][] = [];
      let yMin = Infinity, yMax = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(positions[i], positions[i + 1], positions[i + 2], wm, v);
        flat.push([v.x, v.z]);
        if (v.y < yMin) yMin = v.y;
        if (v.y > yMax) yMax = v.y;
      }
      const circle = enclosingCircle(flat);
      if (!circle || !Number.isFinite(circle.x) || !Number.isFinite(circle.y) || !Number.isFinite(yMin)) continue;
      const axleWorld = new Vector3(circle.x, (yMin + yMax) / 2, circle.y);
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
      if (!isRenderedFloor(stampedFloor(rig[0].mesh), activeFloor)) continue;

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
