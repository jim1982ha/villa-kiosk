// src/babylon/overviewPose.ts
// The overview camera's framing and limits as numbers: the whole-villa fit
// from the model's extents, and every clamp a pose goes through — zoom, tilt
// and pan. No Babylon; OverviewController applies what this returns.
//
// ⚠️ THE CLAMPS WERE WRITTEN AT EIGHT SITES (round 11, 2.496.171) — pinch,
// wheel, the zoom glide, a restored pose, pan and tilt in OverviewController,
// and the room zoom in SceneManager — each re-reading the camera's limits
// with its own `?? 2` / `?? 200` / `?? 0.05` fallback beside a constructor
// that set 3. fitTo's arithmetic had no test at all:
// tests/oracles/overview_pose.mjs.

import { clamp } from "@/utils/geometry";

/** ~3° from straight down … ~80° (near the horizon). */
export const BETA_MIN = 0.05;
export const BETA_MAX = 1.4;

export interface PanBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface RadiusLimits { lo: number; hi: number }
export interface Pose { alpha: number; beta: number; radius: number; target: { x: number; y: number; z: number } }

type Pt = { x: number; y: number; z: number };

/**
 * The whole-villa shot for these extents. `aspectCorrection` widens the span
 * on a narrow viewport (tan(vHalf)/tan(hHalf), at least 1): a portrait phone
 * sees proportionally less width at the same radius, and the upper zoom
 * limit must widen with it or the camera's own clamp pulls the fit back in.
 * Pan may wander a quarter-span past the model; zoom-in stops at 8 % of it.
 */
export function fitFrame(ext: { min: Pt; max: Pt }, aspectCorrection: number): {
  bounds: PanBounds; limits: RadiusLimits; target: Pt; radius: number;
} {
  const span = Math.max(ext.max.x - ext.min.x, ext.max.z - ext.min.z, 4);
  const corrected = span * Math.max(1, aspectCorrection);
  return {
    bounds: {
      minX: ext.min.x - span * 0.25, maxX: ext.max.x + span * 0.25,
      minZ: ext.min.z - span * 0.25, maxZ: ext.max.z + span * 0.25,
    },
    limits: { lo: Math.max(2, span * 0.08), hi: corrected * 2.2 },
    target: { x: (ext.min.x + ext.max.x) / 2, y: ext.min.y + 1, z: (ext.min.z + ext.max.z) / 2 },
    radius: corrected * 1.05,
  };
}

export const clampRadius = (r: number, l: RadiusLimits): number => clamp(r, l.lo, l.hi);
export const clampBeta = (b: number): number => clamp(b, BETA_MIN, BETA_MAX);
export const clampTarget = (x: number, z: number, b: PanBounds): { x: number; z: number } =>
  ({ x: clamp(x, b.minX, b.maxX), z: clamp(z, b.minZ, b.maxZ) });

/** A saved pose, brought inside this model's limits (the height is free). */
export function clampPose(p: Pose, bounds: PanBounds, limits: RadiusLimits): Pose {
  const t = clampTarget(p.target.x, p.target.z, bounds);
  return { alpha: p.alpha, beta: clampBeta(p.beta), radius: clampRadius(p.radius, limits), target: { x: t.x, y: p.target.y, z: t.z } };
}
