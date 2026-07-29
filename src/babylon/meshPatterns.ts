// src/babylon/meshPatterns.ts
// Name-based mesh classification shared across independent structural
// decisions (wall opacity/collision in SceneManager.applyStructure, camera
// beam occluders in EntityVisuals) — one definition of "this is a wall/
// structural surface", not two that can quietly drift apart.

/** Name patterns for genuine structural barriers: walls, partitions,
 *  railings/balustrades, fences, and glazing (window panes, glass balustrade
 *  panels). Deliberately does NOT match "door"/"porte" — a door or its frame
 *  is a much thinner, often-open feature, not a room-defining surface; see
 *  isStructuralMeshName's own docstring for why that matters for beams. */
const STRUCTURAL_NAME_RE =
  /wall|partition|cloison|railing|balustrade|banister|newel|column|pillar|fence|window|glass|slid|baie|vitr/i;

/** The baked pipeline's merged structural meshes (walls+floor+ceiling+ground,
 *  one big mesh per storey) — see blender_pipeline.py's Structure_L1/_L2/
 *  _Exterior naming. Matched separately from STRUCTURAL_NAME_RE because
 *  "Structure_L1" contains none of that regex's substrings. */
const BAKED_STRUCTURE_RE = /^structure/i;

/**
 * Whether `name` is genuinely structural — a wall, partition, railing, fence,
 * glazing panel, or (baked pipeline) one of the merged Structure_* meshes.
 *
 * Used to build the camera beam's occluder set (see CameraBeams.clippedLength
 * and EntityVisuals' buildCameraBeams), which is a NARROWER set than
 * shadowCasters. shadowCasters legitimately includes every piece of static
 * geometry — furniture blocks light too — but a beam's edge-ray sampling
 * takes the MINIMUM reach across 8 rays around the cone's surface (see
 * clippedLength's own docstring for why: catching a beam's SIDE poking
 * through a nearby wall the centreline ray missed). That means a single
 * piece of furniture, a curtain, or a door frame grazed by just one of those
 * edge rays collapses the WHOLE cone to a stub — worse the wider the cone is
 * (field report 2026-07-29, right after the beam was deliberately widened),
 * even when the centre of the beam has a clear, long view across the room.
 * Restricting occluders to what this function matches keeps the "never
 * visibly poke through a real wall" guarantee the edge-ray sampling exists
 * for, while no longer letting a nearby chair or door casing stand in for
 * one.
 */
export function isStructuralMeshName(name: string): boolean {
  return BAKED_STRUCTURE_RE.test(name) || STRUCTURAL_NAME_RE.test(name);
}

export { STRUCTURAL_NAME_RE };
