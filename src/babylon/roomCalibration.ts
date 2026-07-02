// src/babylon/roomCalibration.ts
// Pure plan→world calibration solver, extracted from SceneManager so the three
// fitting strategies are testable without an engine and SceneManager keeps to
// scene orchestration. No Babylon imports: the one scene query the fallback
// strategy needs (does a downward ray hit a floor here?) is injected.

import { fitAffine, affineResidual, spanArea, type PlanWorldPair } from "@/utils/affineFit";
import { polygonCentroid } from "@/config/Sh3dCalibration";

export type PlanToWorld = (px: number, py: number) => { x: number; z: number };

export interface RoomPlan {
  name: string;
  points: { x: number; y: number }[];
}

export interface CalibrationContext {
  /** Plan-position ↔ observed world-position pairs from entity-named meshes. */
  pairs: PlanWorldPair[];
  /** Room polygons in plan space (cm). */
  rooms: RoomPlan[];
  /** Loaded model's horizontal extents (world metres). */
  modelWidth: number;
  modelDepth: number;
  /** Probe for the no-entity fallback: does a downward ray at this world
   *  position hit a flat floor-like mesh? */
  hitsFloorAt: (wx: number, wz: number) => boolean;
}

export interface CalibrationSolution {
  planToWorld: PlanToWorld;
  /** Human-readable summary of which strategy ran (for the dev log). */
  strategy: string;
}

/**
 * SweetHome 3D plan-space unit direction for an object's `angle` (degrees).
 * SweetHome's plan is Y-down (X east, Y south) and the angle spinner turns
 * furniture CLOCKWISE from its modelled "south-facing" (plan +Y) default —
 * unverified against a real rotated camera yet (every camera in the current
 * villa is still at the default angle=0, see EntityCategories/CHANGELOG); if
 * a live test with an actually-rotated camera shows the beam pointing the
 * wrong way, this is the one place to flip the sign or swap sin/cos.
 */
export function planAngleToDir(angleDeg: number): { px: number; py: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { px: Math.sin(rad), py: Math.cos(rad) };
}

/**
 * Build the plan→world transform. Three strategies, in order of accuracy:
 *   1. ≥3 well-spread entity meshes → full affine fit (exact; any rotation/mirror).
 *   2. 1–2 entity meshes → solve sign + translation against the bbox scale
 *      (deterministically fixes left/right + front/back mirroring).
 *   3. No entity meshes → raycast-vote orientation over all four mirror combos.
 * Returns null when there is nothing to fit against (no rooms AND no entity
 * meshes). A manual flipX/flipZ override is layered on top by the caller.
 */
export function solvePlanToWorld(ctx: CalibrationContext): CalibrationSolution | null {
  const { pairs, rooms, modelWidth: modelW, modelDepth: modelD } = ctx;

  // Room-polygon bounding box + scale (needed by strategies 2 and 3).
  let pxMin = Infinity, pxMax = -Infinity, pyMin = Infinity, pyMax = -Infinity;
  for (const r of rooms) for (const p of r.points) {
    pxMin = Math.min(pxMin, p.x); pxMax = Math.max(pxMax, p.x);
    pyMin = Math.min(pyMin, p.y); pyMax = Math.max(pyMax, p.y);
  }
  const planCx = (pxMin + pxMax) / 2;
  const planCy = (pyMin + pyMax) / 2;
  const scaleX = pxMax > pxMin ? modelW / (pxMax - pxMin) : 0.01;
  const scaleZ = pyMax > pyMin ? modelD / (pyMax - pyMin) : 0.01;
  const planScale = (scaleX + scaleZ) / 2;
  // A correct fit should reproduce entity positions to well within the model
  // size; reject a fit whose RMS error exceeds this (ill-conditioned/mismatched).
  const residualLimit = 0.15 * Math.max(modelW, modelD, 1);

  // Strategy 1: affine fit (only if points span real 2D area and fit is tight).
  const M = pairs.length >= 3 && spanArea(pairs) > 1e4 ? fitAffine(pairs) : null;
  if (M && affineResidual(pairs, M) <= residualLimit) {
    return {
      planToWorld: (px, py) => M(px, py),
      strategy:
        `affine fit from ${pairs.length} entity meshes ` +
        `(residual ${affineResidual(pairs, M).toFixed(2)} m)`,
    };
  }

  if (pairs.length >= 1) {
    // Strategy 2: anchor on the entity centroid, choose the mirror signs that
    // best reproduce the observed entity world positions.
    const pCx = pairs.reduce((s, p) => s + p.px, 0) / pairs.length;
    const pCy = pairs.reduce((s, p) => s + p.py, 0) / pairs.length;
    const wCx = pairs.reduce((s, p) => s + p.wx, 0) / pairs.length;
    const wCz = pairs.reduce((s, p) => s + p.wz, 0) / pairs.length;
    let best = { xSign: 1, zSign: 1, err: Infinity };
    for (const xSign of [1, -1]) for (const zSign of [1, -1]) {
      let err = 0;
      for (const p of pairs) {
        const wx = wCx + (p.px - pCx) * planScale * xSign;
        const wz = wCz + (p.py - pCy) * planScale * zSign;
        err += (wx - p.wx) ** 2 + (wz - p.wz) ** 2;
      }
      if (err < best.err) best = { xSign, zSign, err };
    }
    const { xSign, zSign } = best;
    return {
      planToWorld: (px, py) => ({
        x: wCx + (px - pCx) * planScale * xSign,
        z: wCz + (py - pCy) * planScale * zSign,
      }),
      strategy:
        `${pairs.length}-entity sign fit ` +
        `(flipX=${xSign < 0} flipZ=${zSign < 0}, scale=${planScale.toPrecision(4)})`,
    };
  }

  if (rooms.length > 0) {
    // Strategy 3: no entity meshes — vote orientation by raycasting indoor room
    // centroids onto floor meshes across all four mirror combinations.
    const outdoorPat = /garden|pathway|terrace|patio|water|pool|outdoor|ext[eé]|lawn|grass|back.side|carport/i;
    const indoorRooms = rooms.filter((r) => !outdoorPat.test(r.name));
    const testRooms = indoorRooms.length >= 2 ? indoorRooms : rooms;

    const countHits = (xSign: number, zSign: number): number => {
      let hits = 0;
      for (const room of testRooms) {
        const c = polygonCentroid(room.points);
        const wx = (c.x - planCx) * planScale * xSign;
        const wz = (c.y - planCy) * planScale * zSign;
        if (ctx.hitsFloorAt(wx, wz)) hits++;
      }
      return hits;
    };

    let best = { xSign: 1, zSign: 1, hits: -1 };
    for (const xSign of [1, -1]) for (const zSign of [1, -1]) {
      const hits = countHits(xSign, zSign);
      if (hits > best.hits) best = { xSign, zSign, hits };
    }
    const { xSign, zSign } = best;
    return {
      planToWorld: (px, py) => ({
        x: (px - planCx) * planScale * xSign,
        z: (py - planCy) * planScale * zSign,
      }),
      strategy:
        `raycast-vote fallback (no entity meshes) ` +
        `flipX=${xSign < 0} flipZ=${zSign < 0}, ${best.hits}/${testRooms.length} hits`,
    };
  }

  return null;
}
