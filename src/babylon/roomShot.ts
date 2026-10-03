// src/babylon/roomShot.ts
// THE ROOM SHOT: given the rooms a tap asked for and the camera's view, the
// pose the overview camera takes — the pose it ACTUALLY takes, clamp included.
// Pure: tests/oracles/room_shot.mjs drives it by value.
//
// ⚠️ ONE TAP CROSSED FIVE MODULES, AND THE DEEPEST PART HAD NO TEST (2.496.261).
// SceneManager.computeRoomOverviewPose unioned the rooms' bounds, forced the
// zenithal tilt, fitted the walls (roomZoomSolver.roomWallFit), asked the
// badge solver for a tighter rung, floored the answer at MIN_ROOM_FIT_RADIUS —
// and then OverviewController.applyPose clamped it again to the camera's own
// limits. Two consequences, both invisible from any one file:
//   * the floor at 1.5 m could never bind: the camera's zoom-in limit is at
//     least 2 (overviewPose.fitFrame), and applyPose clamped after it;
//   * the `?debug` line printed the radius BEFORE that clamp, so a fit past
//     the zoom-out limit was logged as one radius and flown at another — on
//     the one instrument the owner reads.
// Now the clamp is part of the shot, the floor is the camera's own limit, and
// the debug line prints what the camera does.

import { BETA_MIN, clampPose, type PanBounds, type Pose, type RadiusLimits } from "./overviewPose";
import { roomWallFit, type RoomBounds } from "./roomZoomSolver";
import type { ViewBasis } from "./badgeProjection";

/** The badge solver's question (EntityVisuals.solveRoomZoomRadius): the
 *  closest zoom rung, between the bounds, where the room's badges separate. */
export type RoomZoomSolve = (shot: {
  frame: ViewBasis; cx: number; cy: number; cz: number;
  dir: { x: number; y: number; z: number };
  minRadius: number; maxRadius: number;
}) => { radius: number; declutters: boolean } | null;

export interface RoomShotInput {
  /** Each room asked for: its wall outline when it has one (real), else the
   *  box of its devices' anchors; null when neither exists. */
  rooms: readonly { bounds: RoomBounds | null; real: boolean }[];
  /** The camera's current spin (kept — the room must not turn under the
   *  user) and its field of view on each axis (cameraFrame). */
  view: { alpha: number; vFov: number; hFov: number };
  /** The camera's own limits — what applyPose would clamp to. */
  limits: RadiusLimits;
  pan: PanBounds;
  /** Asked for ONE room only (see below); omitted, the wall fit is the shot. */
  solve?: RoomZoomSolve;
}

export interface RoomShot {
  /** The pose the camera takes, already within its limits. */
  pose: Pose;
  /** The radius asked for before the camera's limits — `pose.radius` differs
   *  from it exactly when a limit bound. */
  requested: number;
  /** The WALL fit before anything else could narrow it, and whether the rung
   *  solver returned at all: `requested / wallFit` is the verdict on a shot
   *  that reads wrong (1.0 = the framing IS the fit). */
  wallFit: number; solved: boolean;
  /** Whether the shot also separates the badges (advisory: they are drawn
   *  individually either way — RoomFocus's exemption). */
  declutters: boolean;
  /** The fit's inputs: every room had a wall outline; the footprint's
   *  half-extents on the view plane (which screen axis bound the fit). */
  real: boolean; halfW: number; halfH: number;
}

/** The shot for these rooms, or null when none of them can be measured. */
export function roomShot(input: RoomShotInput): RoomShot | null {
  // The UNION of every room asked for: a merged chip ("Master Bedroom +1")
  // stands for several rooms, and its tap frames all of them.
  let bounds: RoomBounds | null = null;
  let real = true;
  for (const r of input.rooms) {
    if (!r.real) real = false;
    const b = r.bounds;
    if (!b) continue;
    bounds = bounds ? {
      minX: Math.min(bounds.minX, b.minX), maxX: Math.max(bounds.maxX, b.maxX),
      minZ: Math.min(bounds.minZ, b.minZ), maxZ: Math.max(bounds.maxZ, b.maxZ),
      // The lower floor of the two: framing has to clear the deeper one.
      floorY: Math.min(bounds.floorY, b.floorY),
    } : { ...b };
  }
  if (!bounds) return null;

  // ZENITHAL, whatever the camera was doing: a floor plan from straight above
  // shows a room's devices best, and the same tap gives the same picture.
  // Only the tilt is forced — the camera's own limit, so it cannot drift from
  // what the camera allows — and it is fixed BEFORE the fit, which is
  // measured through it.
  const beta = BETA_MIN;
  const fit = roomWallFit(bounds, real, { alpha: input.view.alpha, beta, vFov: input.view.vFov, hFov: input.view.hFov });

  // ONE room: ask the badges by testing the renderer's own zoom ladder, from
  // the camera's zoom-in limit up to the wall fit (past it the room no longer
  // fills the frame). Several rooms: the wall fit IS the answer — anything
  // tighter would stop framing one of them.
  const solved = input.rooms.length === 1 && input.solve ? input.solve({
    frame: fit.frame, cx: fit.cx, cy: bounds.floorY, cz: fit.cz, dir: fit.destDir,
    minRadius: input.limits.lo, maxRadius: Math.max(fit.radius, input.limits.lo),
  }) : null;
  const requested = solved ? solved.radius : fit.radius;

  const pose = clampPose({
    alpha: input.view.alpha, beta, radius: requested,
    // The room's own centre, at its floor's height (a teleport point stores
    // the first-person EYE; reusing its y tilted the framing up).
    target: { x: fit.cx, y: bounds.floorY, z: fit.cz },
  }, input.pan, input.limits);

  return {
    pose, requested, wallFit: fit.radius, solved: !!solved,
    declutters: solved ? solved.declutters : true,
    real, halfW: fit.halfW, halfH: fit.halfH,
  };
}
