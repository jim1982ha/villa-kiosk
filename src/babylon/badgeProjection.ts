// src/babylon/badgeProjection.ts
//
// THE projection every badge-placement decision is measured through, and the
// only piece of geometry in this subsystem that answers "where are these two
// things relative to each other ON THE GLASS".
//
// ── Why this file imports nothing ────────────────────────────────────────
// Same reason badgePlacement.ts imports nothing: it is the only thing that
// makes any of this testable without a browser, in a project whose only
// verification is a person looking at screenshots on two phones. Everything
// here is arithmetic on plain numbers; `npm run test:placement` runs it under
// Node with the types stripped.
//
// ── The bug this file exists to end ──────────────────────────────────────
// Placement used to measure a 3-axis WORLD distance with only the vertical
// axis foreshortened: `hypot(dx, dy * cos(phi), dz)`. Split a world offset
// into `c` (horizontal, ACROSS the view), `h` (horizontal, ALONG the view) and
// `dy` (vertical), let phi be the camera's pitch below horizontal, and the
// true screen offset is
//
//     ( c ,  sin(phi)*h + cos(phi)*dy ) * pixelsPerWorldUnit
//
// so that expression was wrong twice over:
//
//   1. `h` is DRAWN at sin(phi) of its length and was credited at full length.
//      The overview camera allows phi down to ~9.8 degrees, where the depth
//      axis was over-credited by 5.9x. Measured on hardware in 2.286.0: the
//      count of genuinely overlapping drawn badges was ZERO with the camera
//      near top-down and rose monotonically with the tilt to 5 on a laptop and
//      to 20-30 on a phone with the camera near horizontal. That gradient is
//      1/sin(phi) and nothing else.
//   2. `h` and `dy` land on the SAME screen axis and can CANCEL — a device both
//      higher and further away draws almost exactly where a lower, nearer one
//      does. A distance that adds them in quadrature cannot produce a
//      cancellation at all, at any tilt.
//
// ── Why ORTHOGRAPHIC, and not the true perspective projection ────────────
// The renderer's own `Vector3.Project` is right there and is exact. It is
// nonetheless the wrong tool for DECIDING placement, for four reasons:
//
//   * Orthographic projection of a DIFFERENCE vector is invariant to camera
//     POSITION. Panning and dollying cannot regroup anything. "Badges dance
//     when I pan" is what six earlier rewrites of this subsystem died of, and
//     this property is what keeps it dead.
//   * Items BEHIND the camera project sanely. Off-screen badges deliberately
//     take part in grouping (see ShownLabel.inFront) so that turning the camera
//     cannot change how a room is presented; perspective projects those to
//     garbage.
//   * It is AFFINE, so `project(mean(p)) === mean(project(p))`. A summary card
//     is drawn at its members' world centroid and measured at the projection of
//     that same point — one position, one function, no second accumulator that
//     can drift. Perspective is projective and does NOT commute with the mean,
//     which would make "layout geometry equals render geometry" a matter of
//     discipline instead of a structural fact.
//   * The residual — the perspective divide — is a stated APPROXIMATION, and it
//     is strictly smaller than the 5.9x error it replaces.
//
// What this newly admits is the camera's AZIMUTH. It has to: azimuth is what
// decides which horizontal axis is depth, and no correct metric can be blind to
// it. This completes the argument VERTICAL_FORESHORTEN_STEPS already made for
// the tilt rather than reopening screen space. Precisely what is kept and what
// is spent:
//
//   KEPT   the same view always renders the same way, and returning to a view
//          restores it: no hysteresis, no previous-frame input, no path
//          dependence, order-independence intact.
//   KEPT   panning and dollying within a zoom rung cannot regroup anything.
//   SPENT  orbiting at a fixed zoom now regroups. Note what this is NOT: the
//          2.169.0 ring made badges MOVE relative to each other as the camera
//          turned. This makes them appear and merge AT THEIR OWN ANCHORS, in
//          the direction the geometry actually demands.

/** A projection basis: the camera's view direction, snapped and decomposed. */
export interface ViewBasis {
  /** Horizontal RIGHT vector, (rx, 0, rz). No Y component and no roll term
   *  because no code path in this app rolls the camera — CameraController
   *  writes only rotation.x/.y and OverviewController never touches upVector.
   *  Do not add one "for safety": it would be an unreachable branch that
   *  invites someone to feed it a live upVector, which is a pose input. */
  rx: number;
  rz: number;
  /** Horizontal AZIMUTH unit vector, (ax, 0, az) — the direction the camera
   *  looks along the ground. Perpendicular to (rx, 0, rz). */
  ax: number;
  az: number;
  /** Pitch below horizontal, from the SNAPPED angle. `sinPhi` is how much of a
   *  horizontal ALONG-view offset the view draws; `cosPhi` is how much of a
   *  vertical one. Both from one angle, so the basis stays exactly orthonormal. */
  sinPhi: number;
  cosPhi: number;
  /** Which metric projectToView produces. See VIEW_METRIC in EntityVisuals. */
  mode: ProjectionMode;
}

/**
 * `"plane"` — the view plane. Depth folds into the screen-vertical axis at
 * sin(phi), which is what the renderer draws.
 *
 * `"world3d"` — the pre-2.287.0 metric: depth kept at full length on its own
 * axis, height foreshortened, added in quadrature. Correct only for a camera
 * standing INSIDE the badge cloud, where orthographic's small-angle assumption
 * (|offset| much less than the view distance) fails by construction — see
 * projectToView. It is also the kill switch for the whole change.
 */
export type ProjectionMode = "plane" | "world3d";

/** Plane coordinates, in the same units as the world position handed in. */
export interface ProjectedPoint {
  px: number;
  py: number;
  pz: number;
}

/**
 * Steps the view direction is quantised into over a full turn, for BOTH the
 * azimuth and the pitch.
 *
 * ── Why quantise at all ──────────────────────────────────────────────────
 * The same reason GROUP_ZOOM_STEPS_PER_DOUBLING exists: a live basis re-solves
 * on every sub-pixel camera delta, so a slow orbit resting exactly on a
 * conflict boundary can chatter. Inside a rung nothing re-groups at all.
 *
 * ── Why 256, and why nothing coarser ─────────────────────────────────────
 * 256 steps is 1.41 degrees. An angular error d shifts a pair's projected
 * separation by up to d * |offset| * pixelsPerWorldUnit, and a pair that can
 * interact at all has |offset| * pixelsPerWorldUnit no more than about
 * 2 * (conflict radius) / sin(phi) — roughly 1176 px at this camera's
 * shallowest tilt. So:
 *
 *      16 steps (22.5 deg)  ->  up to 230 px of error   — reintroduces the bug
 *      64 steps ( 5.6 deg)  ->  up to  58 px            — a whole badge
 *     128 steps ( 2.8 deg)  ->  up to  29 px            — borderline
 *     256 steps ( 1.4 deg)  ->  up to  15 px            — under half a badge
 *
 * There is no useful middle: any lattice coarse enough to visibly stop an orbit
 * from regrouping is coarse enough to be wrong. Do not lower this to "reduce
 * regrouping" — the test suite pins the bound.
 *
 * 0 takes the basis LIVE. Kept as an escape hatch, not as the default.
 *
 * ── This REPLACES VERTICAL_FORESHORTEN_STEPS, and cannot reuse it ────────
 * That constant quantised the COSINE into 8 uniform steps. Deriving the depth
 * coefficient from it as sqrt(1 - vScale^2) is exactly zero for every tilt in
 * the top ~11 degrees of this camera's range — the entire along-view axis would
 * collapse and every badge on every view ray would merge, which is worse than
 * the bug being fixed. Quantise the ANGLES, never their trig functions.
 */
export const VIEW_BASIS_STEPS = 256;

/** Snap an angle to the lattice. Anchored to the WORLD axes, never to the
 *  current or previous pose — a lattice that moves with the camera is
 *  hysteresis wearing a different hat. */
function snapAngle(a: number, steps: number): number {
  if (!(steps > 0)) return a;
  const step = (Math.PI * 2) / steps;
  return Math.round(a / step) * step;
}

/**
 * Build the basis from a camera forward vector.
 *
 * `atan2` for both angles, never `asin(|fy|)`: asin is ill-conditioned exactly
 * at the top-down end of the range, which is where a floor plan spends most of
 * its life.
 */
export function viewBasis(
  fx: number,
  fy: number,
  fz: number,
  steps: number,
  mode: ProjectionMode,
): ViewBasis {
  const horiz = Math.hypot(fx, fz);
  // Straight down (or a degenerate forward): the azimuth is undefined and, at
  // cosPhi = 0, contributes nothing to the projection anyway. Pick +Z rather
  // than propagating a NaN through every distance in the frame.
  const theta = horiz > 1e-9 ? snapAngle(Math.atan2(fx, fz), steps) : 0;
  const phi = snapAngle(Math.atan2(Math.abs(fy), horiz), steps);
  const ax = Math.sin(theta);
  const az = Math.cos(theta);
  return {
    // Perpendicular to the azimuth, in the ground plane.
    rx: az,
    rz: -ax,
    ax,
    az,
    sinPhi: Math.sin(phi),
    cosPhi: Math.cos(phi),
    mode,
  };
}

/**
 * The same basis with the angle lattice switched OFF.
 *
 * Quantisation exists so that GROUPING is stable under a moving camera: a
 * lattice is what stops a badge pair regrouping on every pixel of drag. FRAMING
 * is the opposite problem. It runs once, against a destination pose that is
 * already known exactly, and a snapped azimuth there does not stabilise
 * anything — it just aims the frame up to half a lattice step away from where
 * the camera will actually be, which crops the room it was asked to fit.
 *
 * So: quantised for "do these two overlap", exact for "does this fit on
 * screen". Both call the same builder, because they must agree about which way
 * is across and which is along.
 */
export function exactViewBasis(
  fx: number,
  fy: number,
  fz: number,
  mode: ProjectionMode,
): ViewBasis {
  return viewBasis(fx, fy, fz, 0, mode);
}

/**
 * Project a world offset (or position — the map is linear, so either works)
 * onto the view plane. Writes into `out` rather than allocating: this runs once
 * per badge per layout pass.
 *
 * `py` is negated so it increases DOWNWARD, matching both the screen and the
 * sign convention of every other measurement in this subsystem.
 *
 * ── "world3d" mode, and why the walk camera needs it ─────────────────────
 * Orthographic projection is a first-order approximation valid when the badge
 * cloud is small against the view distance. The orbit camera looks AT the
 * villa and roughly satisfies that. The walk camera stands IN it and violates
 * it by construction: first-person pitch rests at ~0, so sinPhi is ~0 and the
 * plane metric discards the depth axis entirely — every badge down a corridor
 * would merge into one. Worked case: two devices dead ahead at 2 m and 8 m,
 * both mounted at 1.0 m with the eye at 1.6 m, project 215 px apart in truth
 * and 0 px apart on the plane.
 *
 * So walk mode keeps the pre-2.287.0 metric, expressed as a THIRD coordinate
 * rather than as a second code path: `hypot(px, py, pz)` in world3d mode is
 * identically the old `hypot(dx, dy * cosPhi, dz)`, because a rotation of the
 * ground plane preserves distance. One `conflicts`, one expression, a data
 * difference.
 */
export function projectToView(
  b: ViewBasis,
  x: number,
  y: number,
  z: number,
  out: ProjectedPoint,
): ProjectedPoint {
  const across = x * b.rx + z * b.rz;
  const along = x * b.ax + z * b.az;
  out.px = across;
  if (b.mode === "plane") {
    // The one line this whole file is about: depth and height are the SAME
    // screen axis, added — not two axes added in quadrature.
    out.py = -(b.sinPhi * along + b.cosPhi * y);
    out.pz = 0;
  } else {
    out.py = -(b.cosPhi * y);
    out.pz = along;
  }
  return out;
}
