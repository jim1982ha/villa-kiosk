// src/babylon/meshRoles.ts
// "What IS this mesh?" — asked of the mesh's own DATA first, and only then
// guessed from its name.
//
// THE PROBLEM THIS SOLVES
// The app has to know which meshes are the villa's structure (walls, slabs,
// ceilings), which storey each belongs to, and which are the always-visible
// exterior. That knowledge is produced by the Blender pipeline, which computes
// it exactly and then — historically — encoded it ONLY in the object's NAME:
// "Structure", "Structure_L2", "Structure_Exterior". Five separate places in
// this app re-derived it by regex-matching those literal English strings.
//
// That coupled the whole app to one pipeline's naming CONVENTION rather than to
// data. Any villa whose structural meshes were named differently — a different
// exporter, a hand-authored GLB, a plan authored in a language other than
// English — would load with no floor switching, no exterior group and no
// structural occluders for camera beams, with nothing on screen to explain why.
// The same applied to the wall/curtain/stair vocabulary lists elsewhere: they
// were English-and-French word lists masquerading as geometry classification.
//
// THE FIX
// blender_pipeline.py ≥2.13.0 stamps the semantics it already knows into the
// glTF `extras` of each structural node (vk_role / vk_level / vk_exterior).
// Babylon surfaces those as `mesh.metadata.gltf.extras`. This module reads that
// FIRST, and falls back to the legacy name patterns only when a GLB carries no
// metadata — so an older GLB keeps working unchanged, while any newly-built
// villa is self-describing regardless of what its meshes happen to be called.
//
// Adding a new structural fact should mean adding a `vk_*` key here and in the
// pipeline — never another word list.

import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { normaliseMeshName } from "../config/EntityMap";

/** glTF `extras` keys written by blender_pipeline.py's _stamp_structure_roles.
 *  Kept in one place so the pipeline contract is greppable from both sides. */
const ROLE_KEY = "vk_role";
const LEVEL_KEY = "vk_level";
const EXTERIOR_KEY = "vk_exterior";

/** LEGACY fallback only — the pre-2.13.0 pipeline's naming convention. Used
 *  exclusively when a mesh carries no `vk_role`, so a GLB built before the
 *  metadata existed still loads with working floors and occluders. New
 *  behaviour must never be added here; add it to the metadata instead. */
const LEGACY_STRUCTURE_RE = /^Structure(?:_L(\d+)|_Exterior)?$/i;
const LEGACY_EXTERIOR_RE = /^Structure_Exterior$/i;

export interface StructureRole {
  /** True when this mesh is villa structure (walls/slabs/ceilings), as opposed
   *  to furniture, an entity-bound prop, or a helper mesh. */
  isStructure: boolean;
  /**
   * True for a CEILING that the pipeline shipped as its own object
   * (`vk_role: "ceiling"`, pipeline ≥2.23.0) — the one structural part the app
   * has to hide per VIEW: a walk-through needs a lid overhead, the top-down
   * overview is a cut-away that a lid turns into a picture of the lid.
   *
   * ⚠️ Still `isStructure: true`. A ceiling occludes, belongs to a storey, and
   * must keep taking part in floor indexing, camera-beam clipping and the badge
   * wall cull — everything that asks "is this the villa's shell". Only its
   * VISIBILITY is special, so only visibility reads this flag. A GLB older than
   * 2.23.0 has no such object and every field here reads exactly as before.
   */
  isCeiling: boolean;
  /** Storey index: 0 = ground floor / exterior, 1.. = upper storeys. Note the
   *  pipeline's own convention — "Structure" (no suffix) and
   *  "Structure_Exterior" are both level 0; "Structure_L2" is level 2. */
  level: number;
  /** The always-visible outdoor group (ground, plot, ground-rooted planting),
   *  which is never hidden by floor switching. */
  isExterior: boolean;
}

const NOT_STRUCTURE: StructureRole = {
  isStructure: false, isCeiling: false, level: 0, isExterior: false,
};

/** The `extras` object Babylon attached from the glTF node, if any. */
function gltfExtras(mesh: AbstractMesh): Record<string, unknown> | null {
  const meta = mesh.metadata as { gltf?: { extras?: Record<string, unknown> } } | undefined;
  const extras = meta?.gltf?.extras;
  return extras && typeof extras === "object" ? extras : null;
}

/**
 * Classify a mesh. Metadata wins; the name is only consulted when the GLB
 * predates the metadata.
 */
export function structureRole(mesh: AbstractMesh): StructureRole {
  const extras = gltfExtras(mesh);
  const role = extras?.[ROLE_KEY];
  // "ceiling" is structure that the app must be able to hide per view — see
  // StructureRole.isCeiling. Both roles read the same level/exterior keys.
  if (role === "structure" || role === "ceiling") {
    const rawLevel = extras![LEVEL_KEY];
    const level = typeof rawLevel === "number" && Number.isFinite(rawLevel)
      ? Math.max(0, Math.trunc(rawLevel))
      : 0;
    return {
      isStructure: true,
      isCeiling: role === "ceiling",
      level,
      isExterior: extras![EXTERIOR_KEY] === true,
    };
  }

  // Legacy GLB: fall back to the old naming convention.
  const name = normaliseMeshName(mesh.name);
  const m = LEGACY_STRUCTURE_RE.exec(name);
  if (!m) return NOT_STRUCTURE;
  return {
    isStructure: true,
    // The legacy name convention predates ceiling objects entirely, so a GLB
    // that reaches this fallback has none — `applyStructure`'s name/height
    // heuristic is what classifies a ceiling there, exactly as before.
    isCeiling: false,
    level: m[1] ? Number(m[1]) : 0,
    isExterior: LEGACY_EXTERIOR_RE.test(name),
  };
}

/** Convenience: is this mesh part of the villa's structure at all? */
export function isStructureMesh(mesh: AbstractMesh): boolean {
  return structureRole(mesh).isStructure;
}

/**
 * Whether a mesh should BLOCK a camera's motion beam.
 *
 * Structure only — deliberately NOT the full shadow-caster set. A beam's reach
 * is the minimum across several rays sampled around the cone's surface (see
 * CameraBeams.clippedLength), so letting furniture, curtains or door trim
 * count as occluders collapses the whole cone to a stub whenever any one of
 * those rays clips a nearby object, even with a clear view straight ahead.
 * Walls, slabs and the exterior shell are the things a camera genuinely cannot
 * see through.
 */
export function blocksCameraBeam(mesh: AbstractMesh): boolean {
  return isStructureMesh(mesh);
}
