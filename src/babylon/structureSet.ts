// src/babylon/structureSet.ts
// The villa's structure pass — walls, stairs, collisions, opacity — and the
// ceilings it finds, with everything that is ever asked of them.
//
// ⚠️ CEILINGS WERE THE MOST-CHANGED SUBJECT IN SceneManager (17 of 30 recent
// commits), spread over the constructor, the view toggle, calibration, config
// updates and dispose. A dispose that forgot the ceiling list was a 35 MB leak
// per remount (b9763abd); a report ran before its inputs existed (bce48122).
// This module OWNS the list: it is rebuilt by `apply`, shown or hidden only by
// `setView`, probed by `ceilingState`, reported by `reportCoverage`, and
// emptied by `clear` — so nothing outside can forget one of them.
//
// Moved verbatim from SceneManager (2.496.67); the rules and their history are
// in the comments that came with them. tests/oracles/structure_set.mjs builds
// slabs in a NullEngine scene and checks what each view and each probe sees.

import { eyeHeightOf } from "./walkerSpawn";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Ray } from "@babylonjs/core/Culling/ray";
// Babylon prototype patches this module depends on (the picking octree its
// ray tests use) — see babylonSideEffects.
import "./babylonSideEffects";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { beginSpan } from "@/utils/perfSpans";
import { debugFlagEnabled } from "@/utils/devLog";
import { tapDebug } from "@/utils/tapDebug";
import { inferTypeFromEntityId } from "@/config/EntityMap";
import { isCeilingMesh, structureRole, isHelperMesh } from "./meshRoles";
import { pointInPolygon } from "@/utils/geometry";

// ⚠️ THE STAIR-FOOT TOLERANCE ("the lowest room floor + 0.30 m is the ground")
// WAS HERE, and was the height rule storeys.ts retired everywhere else: the
// ground rooms are the plan's lowest storey, stairwells excluded
// (Storeys.groundRooms, 2.496.91).

/**
 * The area a mesh's triangles actually COVER, projected onto the ground plane,
 * in m². Not its bounding box.
 *
 * ⚠️ THE BOUNDING BOX LIED, AND IT LIED BY AN ORDER OF MAGNITUDE (2.456.0).
 * `ceiling geometry: foot=649.5m2 (51.3% of villa)` was a sum of bounding boxes,
 * and the per-mesh dump showed why that is not a coverage figure at all:
 * `Structure_Ceiling_L0_primitive8` reports a 27.7 x 13.7 m box — 379 m² — from
 * **20 vertices**, i.e. at most five small quads scattered far apart. A box
 * around scattered panels is the size of the SCATTER, not of the panels.
 *
 * That mattered because the whole "drawn but unseen" conclusion rested on it:
 * half the villa appearing to be covered ruled out "there is simply no ceiling
 * here", and it should not have. Projected triangle area cannot make that
 * mistake — it is the number that says whether there is anything overhead.
 */
function projectedAreaXZ(m: AbstractMesh): number {
  const pos = m.getVerticesData(VertexBuffer.PositionKind);
  const idx = m.getIndices();
  if (!pos || !idx) return 0;
  const w = m.computeWorldMatrix(true);
  const a = Vector3.Zero(); const b = Vector3.Zero(); const c = Vector3.Zero();
  let area = 0;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    for (const [j, v] of [[idx[i], a], [idx[i + 1], b], [idx[i + 2], c]] as const) {
      Vector3.TransformCoordinatesFromFloatsToRef(
        pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2], w, v);
    }
    // Half the cross product's Y component — the triangle's own area projected
    // straight down, which is what "covers the floor below" means. Absolute,
    // so a downward-facing ceiling counts the same as an upward-facing one.
    area += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  }
  return area;
}

/**
 * Horizontal triangle area in a height band, split by which way it FACES.
 *
 * ⚠️ THIS IS THE TEST THAT SEPARATES "the pipeline dropped the ceiling" FROM
 * "SweetHome never exported one" (2.462.0), and it is the question the owner
 * asked directly: their room settings have "Display ceiling" checked, so where
 * did it go?
 *
 * blender_pipeline `_split_for_bake` peels a storey's ceiling off the fused
 * Structure by taking **DOWN-FACING** horizontal faces in a band around the
 * storey boundary (`_ceiling_face_mask(..., facing=-1)`), with a 1.2 m² minimum
 * component area. Anything it does not take stays fused inside `Structure` —
 * where the app can still see it, because by then Draco is decoded. So:
 *
 *   down ≈ 0 and up ≈ 0  → the OBJ has no ceiling here. Model/export problem.
 *   down ≈ 0 and up LARGE → the faces EXIST and point the wrong way, so the
 *                           peel's `facing=-1` filter skipped them. That also
 *                           explains why a ceiling had to be forced
 *                           double-sided in 2.449.0 — SweetHome slabs carry
 *                           inverted normals, and the same inversion defeats
 *                           the peel. FIX: the pipeline, not the app.
 *   down LARGE            → the peel's band or area threshold is too tight.
 *
 * Debug-flag gated and bbox-prefiltered: `Structure` is ~1.4M triangles across
 * ~190 primitives, and this walks index data, so it must not run on a normal
 * boot.
 */
function horizontalAreaInBand(
  m: AbstractMesh, loY: number, hiY: number,
): { down: number; up: number; byHeight: Map<number, number> } {
  const out = { down: 0, up: 0, byHeight: new Map<number, number>() };
  const bb = m.getBoundingInfo().boundingBox;
  if (bb.maximumWorld.y < loY || bb.minimumWorld.y > hiY) return out;
  const pos = m.getVerticesData(VertexBuffer.PositionKind);
  const idx = m.getIndices();
  if (!pos || !idx) return out;
  const w = m.computeWorldMatrix(true);
  const a = Vector3.Zero(); const b = Vector3.Zero(); const c = Vector3.Zero();
  for (let i = 0; i + 2 < idx.length; i += 3) {
    for (const [j, v] of [[idx[i], a], [idx[i + 1], b], [idx[i + 2], c]] as const) {
      Vector3.TransformCoordinatesFromFloatsToRef(
        pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2], w, v);
    }
    const cy = (a.y + b.y + c.y) / 3;
    if (cy < loY || cy > hiY) continue;
    // Cross product of the two edges: its Y component is the projected area
    // (signed by facing), its length is twice the true area.
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    // Same 0.85 threshold the pipeline's own mask uses, so the two answers are
    // comparable rather than merely similar.
    if (Math.abs(ny) / len <= 0.85) continue;
    if (ny < 0) out.down += len / 2; else out.up += len / 2;
    // Which HEIGHTS the unpeeled area sits at, in 10 cm buckets. This is the
    // number the pipeline's band has to be set from: its lower edge is
    // `base + 0.80 * storeyHeight`, and a room with a dropped ceiling (a
    // bathroom, a laundry) sits below that and is silently excluded. A total
    // says the peel is wrong; a histogram says what to change it to.
    if (ny < 0) {
      const k = Math.round(cy * 10) / 10;
      out.byHeight.set(k, (out.byHeight.get(k) ?? 0) + len / 2);
    }
  }
  return out;
}

/**
 * SweetHome bleeds alpha onto surfaces that are meant to be solid, so anything
 * still MOSTLY opaque is treated as a bleed and forced fully opaque; anything
 * at or under half is taken as deliberate (glass, a curtain sheer) and left
 * alone.
 *
 * A free function rather than an inline block at the bottom of applyStructure's
 * loop because the ceiling branch `continue`s before reaching that bottom, and
 * for two releases nobody noticed the ceiling was the ONE surface the rule was
 * not reaching — the surface where a bled alpha means you look through it at
 * the sky. A rule that must apply to a mesh classified early has to be callable
 * from where that classification happens.
 */


function forceOpaque(m: AbstractMesh): void {
  const mat = m.material;
  if (!mat || mat.alpha <= 0.5) return;
  mat.alpha = 1;
  mat.transparencyMode = Material.MATERIAL_OPAQUE;
  if (mat instanceof PBRMaterial) {
    mat.useAlphaFromAlbedoTexture = false;
    if (mat.albedoTexture) mat.albedoTexture.hasAlpha = false;
  }
}


export type ViewMode = "first-person" | "overview";

/** What the structure pass needs from the scene it serves. */
export interface StructureDeps {
  requestRender(): void;
  /** The loaded model's world extents — for the ceiling-geometry report. */
  worldExtents(): { min: Vector3; max: Vector3 };
  /** config.eyeHeight — the same report compares ceilings against it. */
  eyeHeight(): number | undefined;
}

/** The ceiling as seen from where the walker stands — see ceilingState. */
export interface CeilingState {
  enabled: number; visible: number; active: number;
  /** Height of the nearest visible ceiling straight above the eye, or null. */
  above: number | null;
  at: { x: number; y: number; z: number };
  /** Horizontal distance to the closest ceiling panel's centre, or null. */
  near: number | null;
}

export class StructureSet {
  /** Ceiling/roof meshes, as classified by `apply`. Empty on a GLB whose
   *  pipeline already dropped the ceiling in Blender — the common case, and
   *  reported by ?debug rather than left looking like a broken feature. */
  private ceilingMeshes: AbstractMesh[] = [];
  private view: ViewMode = "overview";
  private readonly deps: StructureDeps;
  /** Reused by the overhead probe. */
  private readonly ceilingRay = new Ray(Vector3.Zero(), new Vector3(0, 1, 0), 10);

  constructor(deps: StructureDeps) {
    this.deps = deps;
  }

  get ceilings(): readonly AbstractMesh[] { return this.ceilingMeshes; }

  /** Forget the ceilings (dispose, or a model being replaced). */
  clear(): void { this.ceilingMeshes = []; }

  /**
   * The ceiling's state DURING A WALKING FRAME — see EntityVisuals'
   * setCeilingState for why every earlier report was taken in the one view
   * that hides them. `active` is read from the meshes the last frame actually
   * submitted, the only one of the three that Babylon owns rather than us.
   *
   * ⚠️ `above` IS THE QUESTION SIX ROUNDS NEVER ASKED: is there a ceiling over
   * the walker's head RIGHT NOW? One ray straight up answers it — a height means
   * the geometry is there and the fault is rendering; null means the GLB ships
   * no ceiling over this spot. `near` separates "absent" (metres) from
   * "misplaced" (centimetres).
   */
  ceilingState(eye: { x: number; y: number; z: number }, activeMeshes: readonly AbstractMesh[]): CeilingState {
    const active = new Set(activeMeshes);
    let enabled = 0; let visible = 0; let drawn = 0;
    for (const m of this.ceilingMeshes) {
      if (m.isEnabled()) enabled += 1;
      if (m.isVisible) visible += 1;
      if (active.has(m)) drawn += 1;
    }
    this.ceilingRay.origin.set(eye.x, eye.y, eye.z);
    this.ceilingRay.direction.set(0, 1, 0);
    this.ceilingRay.length = 10;
    let above: number | null = null;
    for (const m of this.ceilingMeshes) {
      if (!m.isEnabled() || !m.isVisible) continue;
      const info = this.ceilingRay.intersectsMesh(m, false);
      if (!info.hit || !info.pickedPoint) continue;
      if (above === null || info.pickedPoint.y < above) above = info.pickedPoint.y;
    }
    let near = Infinity;
    for (const m of this.ceilingMeshes) {
      const c = m.getBoundingInfo().boundingBox.centerWorld;
      near = Math.min(near, Math.hypot(c.x - eye.x, c.z - eye.z));
    }
    return {
      enabled, visible, active: drawn, above,
      at: { x: eye.x, y: eye.y, z: eye.z },
      near: Number.isFinite(near) ? near : null,
    };
  }

  /**
   * Enforce solid (opaque) walls and wall collisions, per config. SweetHome
   * exports sometimes carry a low wall alpha; we force structural surfaces
   * opaque while leaving genuinely transparent things (glass/windows/curtains)
   * alone, and turn on collision for vertical barriers.
   */
  apply(meshes: AbstractMesh[], view: ViewMode): void {
    this.view = view;
    const endSpan = beginSpan("applyStructure");
    try {
      this.applyStructureInner(meshes);
    } finally {
      endSpan();
    }
  }

  private applyStructureInner(meshes: AbstractMesh[]): void {
    // Rebuilt from scratch on every load — these are meshes of the model being
    // replaced, and a stale entry is a disposed mesh the view toggle would
    // still try to write to.
    this.ceilingMeshes = [];
    // Name patterns that are explicitly collidable (walls, railings, glass
    // barriers). Still NAME-based, and deliberately so for now: unlike the
    // pipeline's own structure groups, these are individual SweetHome catalog
    // pieces the pipeline never classified, so there is no metadata to read —
    // this is a best-effort heuristic over whatever the plan's author named
    // them, and it degrades gracefully (a miss just means that piece is not
    // force-opaqued / not collidable, never a broken load). See meshRoles.ts
    // for the parts that DO have real metadata, and the note in that file
    // about not adding new behaviour to word lists like this one.
    const structuralByName =
      /wall|partition|cloison|railing|balustrade|banister|newel|column|pillar|fence|window|glass|slid|baie|vitr/i;
    // Stairs/steps in several languages — these must NEVER collide (you walk up
    // them via floor-following) and are tagged so the camera can climb them.
    const stairPat = /stair|step|escalier|marche|scala|treppe|stufe|trap\b/i;
    // Never block movement through these (floors, outdoor terrain, helpers, stairs).
    const neverCollide =
      /ground|floor|room_|terrain|grass|lawn|water|pool|sky|__root__|ceiling|plafond|toit|ramp|slope/i;


    for (const m of meshes) {
      const name = m.name;
      if (isHelperMesh(m)) continue;

      // HA entity fixtures (light.*, cover.*, fan.*, …) are owned entirely by
      // EntityVisuals — the structural pass must never hide or collide them.
      // The mesh name IS the entity_id (domain prefix before the first dot, even
      // with a Blender ".001" instance suffix), so a known domain marks it as an
      // entity. Without this skip, the ceiling-hide regex below matched any light
      // whose entity_id legitimately contains an architectural word and set it
      // invisible — e.g. light.bedroom_1_…_ceiling_b1 and
      // light.living_room_ceiling_led_… vanished while a sibling like
      // light.…_wallswicth_center (no "ceiling") stayed visible. Honors the
      // "only objects named by the HA convention" rule without hardcoding names.
      if (inferTypeFromEntityId(name)) continue;

      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      const meshH = bb.maximumWorld.y - bb.minimumWorld.y;
      const meshMinY = bb.minimumWorld.y;
      // Horizontal footprint — a single wall is tall but THIN in one axis; a
      // whole-house "fused" wall mesh is tall and LARGE in both axes; furniture
      // is tall but medium-bulky in both. So treat thin-or-large as wall-like.
      const footX = bb.maximumWorld.x - bb.minimumWorld.x;
      const footZ = bb.maximumWorld.z - bb.minimumWorld.z;
      const footMin = Math.min(footX, footZ);
      const footMax = Math.max(footX, footZ);

      // --- Tag stairs so the camera's floor-follower knows it may climb them ---
      const isStair = stairPat.test(name);
      m.metadata = { ...(m.metadata ?? {}), isStair };

      // --- Hide ceiling/roof meshes (named OR floating high above floor level) ---
      // "Above floor level" = bounding box bottom is above 2.5 m and the mesh
      // is flat (height < 0.3 m). This removes outdoor "roofs" and ceilings without
      // hiding Floor 2 elements (whose FLOOR sits at ≈ 3 m but has height > 0.3 m).
      // Pipeline-split structure groups are EXEMPT from the height heuristic:
      // blender_pipeline (≥2.6.0) already drops the top ceiling/roof in Blender,
      // and Babylon splits Structure_L1 into one child mesh per material — so a
      // thin upper-storey slab (a 1 cm SweetHome "Box" floor patch at 2.56 m)
      // is a flat lone primitive that this heuristic ate, leaving a see-through
      // hole in the 2F floor. Name-matched ceilings are still hidden.
      // Classified from the mesh's own pipeline metadata, not its name —
      // see meshRoles.ts (name matching survives only as a legacy fallback).
      const role = structureRole(m);
      const isPipelineStructure = role.isStructure;
      // Tag the load-bearing shell (floor slabs + walls + baked stairs) so the
      // camera can ground on the real FLOOR and never on furniture: these fused
      // meshes contain no furniture, so a downward ray against them alone finds
      // the walking surface even when a table/bed sits directly overhead.
      m.metadata = { ...(m.metadata ?? {}), isStructure: isPipelineStructure };
      // `role.isCeiling` FIRST, because it is the only one of the three that is
      // a FACT rather than a guess: pipeline ≥2.23.0 ships each non-top storey's
      // ceiling as its own object stamped `vk_role: "ceiling"` (before that the
      // app borrowed the storey-above's floor slab, which is why the 1F ceiling
      // wore the 2F floor's texture). The name pattern and the height heuristic
      // stay for every GLB built before that — see meshRoles.ts on why a new
      // structural fact becomes a `vk_*` key and never another word list.
      // `isCeilingMesh` owns the stamp AND the name list (see meshRoles) — the
      // same predicate ModelLoader lights them by, which is the disagreement
      // 2.448.0 closed. The HEIGHT heuristic stays here because it needs a
      // computed world bounding box.
      // ⚠️ A DEGENERATE MESH IS NOT A CEILING (2.456.0). The per-mesh dump
      // caught the height heuristic classifying `BAKED_LightmapCarrier` and
      // `BAKED_LightmapCarrier_Night` — 4-vertex, 0.0 x 0.0 m holders for the
      // day/night lightmap textures, which sit at 2.79 m and are flat, so they
      // satisfy every term of it. They were then counted in `ceilings: 11`, had
      // their `isVisible` driven by the view toggle, and made a fifth of the
      // ceiling census meaningless. A ceiling has AREA; these have none, and
      // `BAKED_` is the pipeline's own prefix for its carriers.
      const degenerate = footMax < 0.01 || m.name.startsWith("BAKED_");
      const byHeight = !isPipelineStructure && !degenerate
        && meshMinY > 2.5 && meshH < 0.35;
      if (!degenerate && (isCeilingMesh(m) || byHeight)) {
        // HIDDEN IN OVERVIEW, SHOWN WHILE WALKING (2.434.0). A ceiling exists to
        // be under, and the two cameras want opposite things from it: the
        // bird's-eye view is a cut-away and a lid over it shows nothing but the
        // lid, while standing inside a room with open sky overhead is the one
        // thing that never reads as "indoors". So the decision moves from load
        // time to the view toggle — `applyCeilingVisibility`, driven by
        // setViewMode, which is also the only thing that may write `isVisible`
        // on these meshes from here on.
        //
        // Collisions stay OFF regardless: the walker climbs stairs by
        // floor-following and CameraController deliberately keeps the space
        // overhead clear (see its ellipsoid note) — a collidable ceiling is how
        // you get wedged mid-staircase.
        m.metadata = { ...(m.metadata ?? {}), isCeiling: true };
        this.ceilingMeshes.push(m);
        m.isVisible = this.view === "first-person";
        m.checkCollisions = false;
        // ⚠️ THIS `continue` SKIPS THE REST OF THE LOOP, AND THE OPACITY
        // NORMALISATION AT THE BOTTOM OF IT IS ONE OF THE THINGS IT SKIPPED
        // (2.454.0). Exactly the shape of 2.450.0, where the same early exit
        // put the ceiling ahead of the UV2 gate: a decision made here is made
        // BEFORE every later rule, so each later rule has to be asked for
        // explicitly or it silently does not apply.
        //
        // SweetHome bleeds alpha onto flat slabs, and a ceiling is the one
        // surface where that is not cosmetic: you look straight up through it
        // at the sky, which is precisely the "no ceiling in first-person"
        // report that four fixes chased. Everything else in the villa got
        // forced opaque at the bottom of this loop and the ceiling did not.
        forceOpaque(m);
        continue;
      }

      // --- Collisions ---
      // Collide only with things that are genuinely walls/barriers, so the camera
      // doesn't snag on furniture (a tall wardrobe/fridge is bulky, not a wall):
      // 1) Explicit name match (wall_XXX, railing, glass …)
      // 2) Tall AND (thin in one axis = a single wall/partition, OR large in both
      //    axes = a fused whole-house wall mesh). Excludes bulky furniture
      //    (wardrobe/fridge) so you no longer snag on it. (Babylon collides
      //    against real triangles, so a fused wall mesh still blocks correctly.)
      // ⚠️ THE NAME TEST CANNOT MATCH FUSED GEOMETRY, AND THE MATERIAL IS THE
      // SURVIVING IDENTITY. The word list above was written for individual
      // SweetHome catalog pieces, but the pipeline FUSES everything into
      // Structure* and Babylon then names one child mesh per glTF primitive —
      // so every structural mesh in this villa is called
      // `Structure_L1_primitiveN`, and the list matches NONE of them: 0 of 344.
      // The same list matches the MATERIAL of 34 of those 344, because glTF
      // splits a fused object by material and SweetHome's material names are
      // the original object's ("Glass_2_2_2_774", "wall_1_2").
      //
      // Found from an owner report of walking straight through a 2F glass
      // balcony railing and falling a storey. Its tap read
      // `collides=n h=0.66 foot=19.21x8.94`: a 0.66 m band of glass, under the
      // 1.2 m "tall enough to be a wall" bar, with a name that could never
      // match. Both tests failed and nothing else was left to catch it.
      //
      // ⚠️ A material match RELAXES THE HEIGHT BAR, it does not grant collision
      // outright — `footMax > 3.0` still has to hold, so a barrier has to span
      // a real run. That is deliberate: the list contains `glassBowl`, and a
      // decorative bowl must not become a wall. Height alone is the wrong test
      // for a balustrade (they are waist-high by definition); spanning nineteen
      // metres is the thing that makes it a barrier.
      const barrierMaterial = structuralByName.test(m.material?.name ?? "");
      const isWallShaped = (meshH > 1.2 && (footMin < 0.5 || footMax > 3.0))
        || (barrierMaterial && footMax > 3.0);
      const isExplicit = structuralByName.test(name);
      const isExcluded = neverCollide.test(name) || isStair;
      // Wall collisions are always on (the toggle was removed — you should
      // never walk through a wall); only shape/exclusion decides.
      m.checkCollisions = !isExcluded && (isExplicit || isWallShaped);

      // --- Raycast/collision acceleration ---
      // CameraController.followFloor() raycasts straight down against this
      // same structural geometry on EVERY frame while walking (plus a second
      // fallback raycast when the first misses), and Babylon's own built-in
      // moveWithCollisions does an equivalent ray/triangle test for every
      // collidable mesh — both against exactly the geometry
      // EntityVisuals.surfaceBelowCache's own docstring measured as "a linear
      // scan over a 1.4-million-triangle structure mesh with no picking
      // octree", ~950ms worth at load time. That path gets away with it by
      // caching each answer (a light fixture's position never moves); a
      // walking camera can't cache a raycast whose answer changes every
      // step, so the fix has to be the mesh's own acceleration structure
      // instead — this is what was actually freezing the UI the instant
      // first-person movement started (pure look-around never raycasts at
      // all, which is why only walking hung). A submesh octree only helps a
      // mesh with enough submeshes to spatially partition; on one with too
      // few it is a no-op octree build at load and changes nothing at
      // runtime, so it's safe to request unconditionally on every
      // structural/collidable mesh above a trivial size rather than trying
      // to guess which ones actually benefit.
      if ((isPipelineStructure || m.checkCollisions) && m.getTotalVertices() > 1500) {
        m.useOctreeForPicking = true;
        m.useOctreeForCollisions = true;
        m.createOrUpdateSubmeshesOctree();
      }

      // --- Opacity --- (see forceOpaque; the ceiling branch above calls it too)
      forceOpaque(m);
    }
    // The one field that separates "this villa has no ceiling geometry" from
    // "the ceiling feature is broken". A pipeline ≥2.6.0 DROPS the top
    // ceiling/roof in Blender, so zero here is the expected answer on a
    // freshly-baked villa and means the GLB, not this code, is what has to
    // change. Reported once per load rather than per mesh.
    // ⚠️ A LOW NUMBER HERE IS NOT "the rest is covered by something else" any
    // more. The storey-above slab stood in for a missing ceiling from 2.435.0
    // to 2.443.0 and is GONE (2.444.0) — it wore the 2F floor's texture, and it
    // could never roof the TOP storey, the one storey whose ceiling the pipeline
    // deliberately drops. So this count is now the whole of what roofs a walker.
    // `stamped` separates the two eras: a pipeline ≥2.23.0 GLB reports real
    // ceiling OBJECTS, so a low number is now a finding rather than the norm.
    // ⚠️ DELIBERATELY NOT `isResolvedCeiling` — /dry-audit will re-flag these
    // otherwise. Every other consumer asks "IS this a ceiling"; these two ask
    // "which ROUTE classified it", which is the entire purpose of the line: a
    // capture reading `11 shown` beside an invisible ceiling was a true
    // statement that hid the fault, and splitting stamped / by-name / by-height
    // is what made "this GLB ships none" distinguishable from "the feature is
    // broken". Collapsing them onto the resolved answer would delete the
    // distinction and put that blind spot back.
    const stamped = this.ceilingMeshes.filter((m) => structureRole(m).isCeiling).length;
    const named = this.ceilingMeshes.filter(
      (m) => !structureRole(m).isCeiling && isCeilingMesh(m)).length;
    // `enabled=` is the field that separates the two ways a "shown" ceiling can
    // still be absent: the floor filter disabled it (FloorManager runs BEFORE
    // this), or it is drawn and you cannot see it (orientation, lighting). The
    // line said "11 shown" for two releases while they were back-face culled —
    // true, and useless, which is the failure mode this project keeps paying for.
    const enabled = this.ceilingMeshes.filter((m) => m.isEnabled(false)).length;
    tapDebug(
      `ceilings: ${this.ceilingMeshes.length} mesh(es) shown in first-person`
      + ` (${enabled} enabled on the active floor)`
      + ` (${stamped} stamped vk_role=ceiling, ${named} by name,`
      + ` ${this.ceilingMeshes.length - stamped - named} by height)`
      + (stamped + named === 0 && this.ceilingMeshes.length === 0
        ? " — NONE: this GLB ships no ceiling geometry"
        : ""),
    );
    this.reportCeilingGeometry();
    this.reportUnpeeledCeiling(meshes);
    this.deps.requestRender();
  }

  /**
   * WHERE the ceilings are, in world units — the diagnostic that four fixes
   * were shipped without.
   *
   * Every previous ceiling report answered a question about the CODE ("is it
   * enabled", "is it visible", "did it get a lightmap", "is it double-sided")
   * and all four came back healthy while nothing was on screen. Each of those
   * fixes was real, and none of them could ever have answered the remaining
   * possibility, which is about the GEOMETRY: that these meshes are not over
   * anywhere a person stands. The pipeline peel found a 1.79 m lintel and zero
   * stamped objects, which is the shape of "SweetHome emitted a few strays" —
   * so the two hypotheses left are "nothing is above the walker" and "it is
   * drawn and unseen", and they are separated by three numbers.
   *
   *   `y=` the world Y band the ceilings occupy. Under ~2 m and this is trim,
   *         a lintel or a soffit, not a lid — no lighting fix can help it.
   *   `foot=` their combined XZ footprint as a FRACTION of the villa's own.
   *         A few percent is "some rooms only"; near zero is "strays".
   *   `eye=` the walker's eye height, so the band can be read against the head
   *         it is meant to be above without a second lookup.
   *
   * On `tapDebug`, never `devLog`, for the reason the lighting line is: three
   * rounds of this were diagnosed from owner-pasted kiosk logs, where anything
   * stripped outside DEV is invisible.
   */
  private reportCeilingGeometry(): void {
    if (!this.ceilingMeshes.length) return;
    // ⚠️ THE GATE SKIPS THE WORK, NOT JUST THE LINE (2.480.0, /dry-audit).
    // `projectedAreaXZ` walks every triangle of every ceiling mesh, twice —
    // once for the total and once per mesh — and that is pure waste on a boot
    // nobody is debugging. Same rule the placement tier already follows.
    if (!debugFlagEnabled()) return;
    let minY = Infinity; let maxY = -Infinity; let foot = 0; let area = 0;
    for (const m of this.ceilingMeshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      minY = Math.min(minY, bb.minimumWorld.y);
      maxY = Math.max(maxY, bb.maximumWorld.y);
      // Bounding-box footprint, summed per mesh rather than unioned: it
      // over-counts overlap and that is the safe direction here — the finding
      // this is looking for is a number far too SMALL to be a villa's ceiling.
      foot += (bb.maximumWorld.x - bb.minimumWorld.x)
        * (bb.maximumWorld.z - bb.minimumWorld.z);
      area += projectedAreaXZ(m);
    }
    const ext = this.deps.worldExtents();
    const villaFoot = Math.max(1e-6, (ext.max.x - ext.min.x) * (ext.max.z - ext.min.z));
    // ⚠️ `alpha=` is the field the first geometry line was missing, and the one
    // that turned "drawn but unseen" from a category into a mechanism: an owner
    // screenshot looking up from the ground floor showed SKY through translucent
    // planes overhead. A ceiling you can see through is not a lighting bug and
    // not a visibility bug, which is why four fixes aimed at those missed it.
    // `see-through=` counts the ones still under 1 AFTER forceOpaque has run,
    // so a non-zero value means a ceiling is deliberately transparent in the
    // GLB (alpha ≤ 0.5) rather than bleeding — a different finding, and one
    // this app must not silently paper over.
    let minAlpha = 1;
    let seeThrough = 0;
    for (const m of this.ceilingMeshes) {
      const a = m.material?.alpha ?? 1;
      minAlpha = Math.min(minAlpha, a);
      if (a < 1) seeThrough += 1;
    }
    tapDebug(
      `ceiling geometry: y=${minY.toFixed(2)}..${maxY.toFixed(2)}m`
      + ` bbox=${foot.toFixed(1)}m2`
      // ⚠️ READ `area=`, NOT `bbox=`. See projectedAreaXZ: the box figure is the
      // size of the SCATTER between panels, not of the panels, and reading it as
      // coverage is what made "half the villa is covered" look like a fact.
      + ` area=${area.toFixed(1)}m2 (${(100 * area / villaFoot).toFixed(1)}% of villa)`
      + ` eye=${eyeHeightOf(this.deps.eyeHeight()).toFixed(2)}m`
      + ` alpha=${minAlpha.toFixed(2)} see-through=${seeThrough}/${this.ceilingMeshes.length}`
      + (maxY < eyeHeightOf(this.deps.eyeHeight())
        ? " — ENTIRELY BELOW EYE LEVEL: this is trim, not a lid"
        : ""),
    );
    // ⚠️ PER MESH, because every aggregate so far has been a true statement that
    // hid the fault. `foot=` is a SUM of bounding boxes and deliberately
    // over-counts overlap, so 51% of the villa is consistent with two big
    // overlapping slabs covering one wing and nothing over the room the walker
    // is standing in. Names and centres are what separate those, and a name is
    // also the only thing that can be taken back to the pipeline: `0 stamped
    // vk_role=ceiling` means SweetHome emitted these as ordinary objects, so
    // which objects they are is the question the GLB has to answer.
    for (const m of this.ceilingMeshes) {
      const bb = m.getBoundingInfo().boundingBox;
      tapDebug(
        `  ceiling "${m.name}"`
        + ` y=${bb.minimumWorld.y.toFixed(2)}..${bb.maximumWorld.y.toFixed(2)}`
        + ` xz=${bb.centerWorld.x.toFixed(1)},${bb.centerWorld.z.toFixed(1)}`
        + ` bbox=${(bb.maximumWorld.x - bb.minimumWorld.x).toFixed(1)}x`
        + `${(bb.maximumWorld.z - bb.minimumWorld.z).toFixed(1)}m`
        + ` area=${projectedAreaXZ(m).toFixed(1)}m2`
        + ` floor=${(m.metadata as { floorIndex?: number } | null)?.floorIndex ?? "-"}`
        + ` verts=${m.getTotalVertices()}`
        // ⚠️ `visibility` is NOT `isVisible`. Babylon has both: the boolean gates
        // submission, this is a 0..1 alpha multiplier applied when drawing. A
        // mesh at visibility 0 is enabled, isVisible, in the active list and
        // draws nothing — every counter this feature has would read healthy.
        // Never checked in six rounds, so it is printed rather than assumed.
        + ` vis=${m.visibility.toFixed(2)}`,
      );
    }
  }

  /**
   * Is there ceiling geometry still FUSED INTO `Structure` that the pipeline's
   * peel did not take? See `horizontalAreaInBand` for the full reasoning and
   * for how to read the two numbers.
   *
   * Reported against what WAS peeled, so the line is self-contained: if the
   * unpeeled down-facing area dwarfs `Structure_Ceiling_L0`'s, the peel's band
   * or threshold is wrong; if the UP-facing area dwarfs both, SweetHome's
   * ceiling faces are inverted and the peel's down-facing filter is skipping
   * them; if both are ~0, the export genuinely contains no more ceiling.
   */
  private reportUnpeeledCeiling(meshes: AbstractMesh[]): void {
    if (!debugFlagEnabled() || !this.ceilingMeshes.length) return;
    // The band the pipeline searches, in world metres: 80% of the storey up to
    // 15% past its boundary. Taken from the drawn ceilings rather than assumed,
    // so this holds for a villa with any storey height.
    let loY = Infinity; let hiY = -Infinity;
    for (const m of this.ceilingMeshes) {
      const bb = m.getBoundingInfo().boundingBox;
      loY = Math.min(loY, bb.minimumWorld.y);
      hiY = Math.max(hiY, bb.maximumWorld.y);
    }
    loY -= 0.5; hiY += 0.5;
    const ceilingSet = new Set(this.ceilingMeshes);
    let down = 0; let up = 0; let scanned = 0;
    /** The down-facing subset in meshes actually enabled on this storey. */
    let downHere = 0;
    const byHeight = new Map<number, number>();
    const byMesh = new Map<string, number>();
    const byMeshHeight = new Map<string, Map<number, number>>();
    for (const m of meshes) {
      if (ceilingSet.has(m) || m.getTotalVertices() === 0) continue;
      if (m.metadata?.isStructure !== true) continue;
      const r = horizontalAreaInBand(m, loY, hiY);
      if (r.down || r.up) scanned += 1;
      down += r.down; up += r.up;
      // ⚠️ ONLY WHAT IS DRAWABLE HERE CAN BE "LEFT BEHIND" (2.482.0). `down`
      // counts every structure mesh, including the storey ABOVE — which is
      // disabled while you walk below it and whose floor slab the peel is right
      // to leave alone. Judging the verdict on the raw total made it shout
      // "PEEL TOO NARROW" at 339 m² of upper-storey slab while the line
      // directly beneath it correctly called that "a floor slab". An instrument
      // that keeps printing after its question closes does not go neutral, it
      // starts lying — so the verdict now reads the enabled subset and the raw
      // total stays visible beside it.
      if (m.isEnabled()) downHere += r.down;
      for (const [k, v] of r.byHeight) byHeight.set(k, (byHeight.get(k) ?? 0) + v);
      // ⚠️ WHICH OBJECT the area belongs to, and whether that object is even
      // DRAWN on this storey. Without this the previous verdict ("PEEL TOO
      // NARROW — fix the pipeline") could not be told from its opposite: the
      // scan accepts every `isStructure` mesh, which includes `Structure_L1`,
      // and the upper storey is DISABLED while you walk the lower one. Area
      // sitting in a hidden mesh is the storey-above SLAB — the thing the lid
      // fallback exists to show — not ceiling the peel forgot. Same number,
      // opposite owner, and I nearly sent the owner to edit their pipeline on
      // the strength of it.
      const stem = m.name.replace(/_primitive\d+$/, "");
      const key = `${stem}${m.isEnabled() ? "" : " [DISABLED here]"}`;
      byMesh.set(key, (byMesh.get(key) ?? 0) + r.down);
      // ⚠️ PER OBJECT **AND** PER HEIGHT, because the aggregate is ambiguous in
      // exactly the way that made me retract a correct finding (2.468.0). Seeing
      // 473 m2 sitting in `Structure_L1` I concluded "that is the upper storey's
      // floor slab" and called the pipeline correct. The owner then said they
      // had set "Display ceiling" on the INTERIOR rooms and NOT on the patio or
      // onsen — the exact inverse of what the app reports as covered — which
      // means the 9 peeled objects are the patio/onsen ROOFS, and their real
      // ceilings are somewhere else.
      //
      // A floor slab sits at ONE height, the storey boundary. Room ceilings sit
      // at the two or three heights the rooms were drawn with. So the SHAPE of
      // this histogram, per object, tells them apart — and blender_pipeline's
      // own v2.24.0 note records this precise failure ("Structure_L1 reached
      // DOWN to 2.25 m while Structure topped out at 2.51 m"), which it believed
      // it had fixed by peeling before the level split.
      let hm = byMeshHeight.get(key);
      if (!hm) { hm = new Map(); byMeshHeight.set(key, hm); }
      for (const [k, v] of r.byHeight) hm.set(k, (hm.get(k) ?? 0) + v);
    }
    let peeled = 0;
    for (const m of this.ceilingMeshes) peeled += projectedAreaXZ(m);
    tapDebug(
      `unpeeled ceiling: down=${down.toFixed(1)}m2 up=${up.toFixed(1)}m2`
      + ` still fused in ${scanned} structure mesh(es), band ${loY.toFixed(2)}..${hiY.toFixed(2)}m`
      + ` (peeled=${peeled.toFixed(1)}m2)`
      + ` here=${downHere.toFixed(1)}m2`
      + (downHere > peeled
        ? " — PEEL TOO NARROW: down-facing ceiling was left behind on THIS storey"
        : up > 4 * Math.max(down, peeled)
          ? " — INVERTED NORMALS: faces exist but point UP, so the peel's"
            + " down-facing filter skips them (pipeline fix)"
          : " — the remainder is the storey above's slab, correctly left"),
    );
    // Descending by area: the top few buckets are the heights the pipeline's
    // band must cover, and comparing them against the peeled ceilings' own
    // 2.44-2.74 m says whether the band is too high, too low, or too thin.
    const top = [...byHeight].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (top.length) {
      tapDebug(`  unpeeled down-facing by height: `
        + top.map(([k, v]) => `${k.toFixed(1)}m=${v.toFixed(0)}m2`).join(" "));
    }
    const tops = [...byMesh].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (tops.length) {
      tapDebug(`  unpeeled down-facing by object: `
        + tops.map(([k, v]) => `${k}=${v.toFixed(0)}m2`).join(" "));
    }
    for (const [k] of tops.slice(0, 3)) {
      const hm = byMeshHeight.get(k);
      if (!hm) continue;
      const hs = [...hm].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (hs.length) {
        tapDebug(`    ${k}: `
          + hs.map(([h, v]) => `${h.toFixed(1)}m=${v.toFixed(0)}m2`).join(" ")
          // ONE height means a slab; several means room lids.
          + (hs.length >= 2 && hs[1][1] > 0.25 * hs[0][1]
            ? " — SEVERAL HEIGHTS: room ceilings, not one floor slab"
            : " — single height: a floor slab"));
      }
    }
    // Where each structure group actually SITS. The pipeline's own v2.24.0 note
    // diagnosed this bug from exactly these two numbers.
    const groups = new Map<string, { lo: number; hi: number }>();
    for (const m of meshes) {
      if (m.metadata?.isStructure !== true || m.getTotalVertices() === 0) continue;
      const stem = m.name.replace(/_primitive\d+$/, "");
      const bb = m.getBoundingInfo().boundingBox;
      const g = groups.get(stem) ?? { lo: Infinity, hi: -Infinity };
      g.lo = Math.min(g.lo, bb.minimumWorld.y);
      g.hi = Math.max(g.hi, bb.maximumWorld.y);
      groups.set(stem, g);
    }
    tapDebug(`  structure groups: `
      + [...groups].map(([k, g]) => `${k}=${g.lo.toFixed(2)}..${g.hi.toFixed(2)}m`).join(" "));
  }

  /**
   * WHICH ROOMS HAVE A CEILING OVER THEM, BY NAME — the instrument every
   * previous ceiling report was missing (2.458.0).
   *
   * Six rounds measured the ceiling as a SET (how many exist, are enabled,
   * visible, lit, opaque, submitted) and one round measured its total area. Not
   * one of them could answer the question the owner keeps actually asking,
   * which is about a PLACE: "I am standing here and there is no ceiling above
   * me." `above=` answers it for one point; this answers it for the whole plan,
   * and names the rooms, which is the only form of the answer that is
   * ACTIONABLE — an uncovered room is a room to switch "Display ceiling" on for
   * in SweetHome, and the app cannot fix it at all.
   *
   * ⚠️ It also replaces a denominator that was wrong. `ceiling geometry`'s
   * percentage divides by the world extents, which include the terrain and the
   * palm trees, so it understates coverage of the HOUSE by however much garden
   * the model ships. Room polygons are the honest denominator: they are the
   * floor area a person can stand on.
   *
   * Samples a grid inside each ground-level room rather than its centroid,
   * because a room with a ceiling over half of it is a different finding from
   * one with none, and a centroid cannot tell them apart.
   */
  reportCoverage(plan: { groundRooms(): readonly { name: string; pts: { x: number; z: number }[]; floorY: number }[] }): void {
    if (!this.ceilingMeshes.length) return;
    // ⚠️ THE MOST EXPENSIVE DIAGNOSTIC IN THE APP, AND IT WAS UNGATED
    // (2.480.0, /dry-audit). Up to 14 ground rooms x 25 grid samples x 16
    // ceiling meshes is ~5,600 ray/mesh intersections, run on EVERY boot to
    // print a line only a debugging session reads.
    if (!debugFlagEnabled()) return;
    const rooms = plan.groundRooms();
    if (!rooms.length) return;

    const ray = new Ray(Vector3.Zero(), new Vector3(0, 1, 0), 12);
    const covered: string[] = [];
    const bare: string[] = [];
    let totalArea = 0;
    let coveredArea = 0;
    for (const r of rooms) {
      let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
      for (const p of r.pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      const N = 5;
      let inside = 0; let hit = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const px = minX + ((i + 0.5) / N) * (maxX - minX);
          const pz = minZ + ((j + 0.5) / N) * (maxZ - minZ);
          if (!pointInPolygon(px, pz, r.pts)) continue;
          inside += 1;
          ray.origin.set(px, r.floorY + 1.0, pz);
          ray.direction.set(0, 1, 0);
          ray.length = 12;
          if (this.ceilingMeshes.some((m) => ray.intersectsMesh(m, true).hit)) hit += 1;
        }
      }
      if (!inside) continue;
      // The polygon's own area, so a big bare room outweighs a small covered one
      // in the summary rather than counting once each.
      let a2 = 0;
      for (let i = 0; i < r.pts.length; i++) {
        const p = r.pts[i]; const q = r.pts[(i + 1) % r.pts.length];
        a2 += p.x * q.z - q.x * p.z;
      }
      const area = Math.abs(a2) / 2;
      totalArea += area;
      coveredArea += area * (hit / inside);
      (hit / inside >= 0.5 ? covered : bare).push(
        `${r.name}${hit ? ` (${Math.round(100 * hit / inside)}%)` : ""}`);
    }
    tapDebug(
      `ceiling coverage: ${covered.length}/${covered.length + bare.length} ground rooms`
      + ` — ${(100 * coveredArea / Math.max(1e-6, totalArea)).toFixed(0)}% of ${totalArea.toFixed(0)}m2 floor area`,
    );
    if (bare.length) tapDebug(`  NO ceiling over: ${bare.join(", ")}`);
    if (covered.length) tapDebug(`  ceiling over: ${covered.join(", ")}`);
  }

  /**
   * Show ceiling/roof meshes while walking, hide them in the bird's-eye view.
   *
   * The overview is a CUT-AWAY: it looks down into rooms, and a lid over them
   * hides everything the view exists to show — which is why these meshes were
   * hidden unconditionally at load until 2.434.0. First-person has the opposite
   * requirement: standing in a room with open sky overhead never reads as being
   * indoors. Same meshes, opposite answers, so the answer belongs to the view
   * toggle rather than to the load path.
   *
   * ⚠️ `isVisible`, never `setEnabled` — FloorManager owns setEnabled for the
   * per-storey cut and the two must not stomp each other (see its header). That
   * also means this cannot resurrect a ceiling belonging to a hidden storey:
   * FloorManager has already disabled it, and a disabled mesh does not render
   * however visible it claims to be. Walking on 1F therefore gets 1F's ceiling
   * and not 2F's, with no storey logic here at all.
   */
  /** Shown while walking, hidden in the bird's-eye cut-away — the ONLY writer
   *  of `isVisible` on a ceiling. */
  setView(view: ViewMode): void {
    this.view = view;
    const show = view === "first-person";
    for (const m of this.ceilingMeshes) {
      if (m.isVisible !== show) m.isVisible = show;
    }
  }
}
