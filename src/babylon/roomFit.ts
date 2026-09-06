// src/babylon/roomFit.ts
//
// How far back the overview camera must sit for a room's footprint to fill the
// screen — the arithmetic only, over numbers.
//
// ── Why this file exists ──────────────────────────────────────────────────
// This was ~80 lines in the middle of `SceneManager.computeRoomOverviewPose`,
// a method on a class that cannot be constructed without a GPU context, so
// none of it could be run by anything but a person holding a tablet. Its own
// docstring counts what that cost: "Guessing between those two is what three
// releases did wrong before 2.361.0 measured it, and 2.426.0 is the fourth —
// it read 0.53x for a long thin room and ~1.0 after." Four releases wrong, on
// arithmetic that needs nothing but numbers.
//
// It imports `badgeProjection`, which imports nothing, so bare node can load
// it through `tests/consistency/register.mjs`. What stays in SceneManager is
// the adapter: reading the camera, the room bounds and the badge ladder.
//
// ── The rule, stated once ─────────────────────────────────────────────────
// Fit the footprint AS PROJECTED, per screen axis, against that axis's OWN
// half-angle. It used to fit a bounding SPHERE inside the TIGHTER of the two
// angles; both halves of that are rotation-invariant, and on a portrait phone
// they compound into a shot dramatically too far out — the room was pushed
// back until its DIAGONAL fitted the screen's SHORT axis, leaving the tall
// axis, most of the glass, empty.
//
// Measured, not argued (v2.362.0 telemetry): the same Living Room reports a
// bounding sphere of 7.157 m on a 704x845 tablet, 7.151 m on a 932x616 tablet
// and 7.157 m on a 475x661 phone — the room is identical, and every difference
// in the resulting shot was the formula. One room wanted radius 36.05 at
// aspect 0.719 and 51.13 at aspect 0.495: 42% further out on the iPhone for
// the same room, which is the "zoom level is too low" that was reported.
//
// `tan`, not `sin`: a floor seen from above is a plane facing the camera, and
// the distance at which a plane's half-extent subtends a half-angle is
// extent/tan. `sin` is the tangent-sphere form and is the more conservative of
// the two by 1/cos — small next to the anisotropy, but wrong the same way.

import { exactViewBasis, projectToView, type ProjectedPoint } from "./badgeProjection";

/** The share of the viewport a framed room fills when every room in the shot
 *  had a real wall polygon. ⚠️ APPLIED AFTER the per-axis fit, never before —
 *  that order is what makes one number correct on every aspect ratio. */
export const ROOM_FIT_VIEWPORT_FRACTION = 0.6;

/** The fraction for the entity-anchor fallback: a SMALLER share of the
 *  viewport, which is a WIDER shot. Entity anchors mark DEVICES, not walls, so
 *  their box under-states the room and the framing needs more headroom than a
 *  true polygon does.
 *
 *  ⚠️ THIS SAID "the wider fraction" AND IT IS THE SMALLER NUMBER. The fraction
 *  is how much of the glass the room fills; the shot is what gets wider. A
 *  reader checking the arithmetic against the sentence would find them
 *  disagreeing about which direction 0.45 moves the camera. */
export const ROOM_FIT_VIEWPORT_FRACTION_ENTITIES = 0.45;

/** Never closer than this, whatever the arithmetic says. A one-device room has
 *  a degenerate footprint and would otherwise frame to nothing. */
export const MIN_ROOM_FIT_RADIUS = 1.5;

export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
}

export interface ViewDirection {
  x: number;
  y: number;
  z: number;
}

export interface WallFit {
  /** How far back the camera sits. */
  radius: number;
  /** The footprint's half-extents on the view plane. These say which SCREEN
   *  AXIS bound the fit — compare `halfW/tan(hHalf)` against `halfH/tan(vHalf)`
   *  and the larger one won — which is how one number is checked on a portrait
   *  phone and a landscape laptop. */
  halfW: number;
  halfH: number;
  /** The direction the camera looks, at the destination tilt. */
  direction: ViewDirection;
  /** The orbit centre: the footprint's middle, on its own floor. */
  target: { x: number; y: number; z: number };
  /** Which fraction was applied, so a shot that reads wrong is attributable
   *  without another measurement round. */
  fraction: number;
}

/**
 * Merge the rooms asked for into one box.
 *
 * ⚠️ THE UNION, NOT THE WINNER. A merged chip ("Master Bedroom +1") stands for
 * several rooms at once and a short tap on it frames all of them, so the box to
 * fit is their union — not whichever room happened to win the chip's label.
 *
 * ⚠️ THE LOWER FLOOR OF THE TWO, because framing has to clear the deeper one.
 */
export function unionFootprint(
  boxes: readonly (Footprint | null | undefined)[],
): Footprint | null {
  let out: Footprint | null = null;
  for (const b of boxes) {
    if (!b) continue;
    out = out ? {
      minX: Math.min(out.minX, b.minX), maxX: Math.max(out.maxX, b.maxX),
      minZ: Math.min(out.minZ, b.minZ), maxZ: Math.max(out.maxZ, b.maxZ),
      floorY: Math.min(out.floorY, b.floorY),
    } : { ...b };
  }
  return out;
}

/**
 * Which way an ArcRotateCamera looks, at this orbit angle and tilt.
 *
 * Babylon puts the camera at `target + r(cos α sin β, cos β, sin α sin β)`, so
 * the direction it LOOKS is the negated unit offset. At the destination tilt
 * this is very nearly straight down, which is the whole point of the shot — and
 * it is what the fit below has to measure through.
 */
export function viewDirection(alpha: number, beta: number): ViewDirection {
  const sb = Math.sin(beta);
  return {
    x: -Math.cos(alpha) * sb,
    y: -Math.cos(beta),
    z: -Math.sin(alpha) * sb,
  };
}

/**
 * The footprint's half-extents on the view plane.
 *
 * ⚠️ FOUR CORNERS ARE ENOUGH. The projection is linear, so the projected
 * corners bound the whole footprint exactly — no corner can escape a frame that
 * holds all four.
 */
export function viewFrame(direction: ViewDirection) {
  return exactViewBasis(direction.x, direction.y, direction.z, "plane");
}

export function projectedHalfExtents(
  bounds: Footprint,
  direction: ViewDirection,
): { halfW: number; halfH: number } {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const frame = viewFrame(direction);
  const scratch: ProjectedPoint = { px: 0, py: 0, pz: 0 };
  let halfW = 0;
  let halfH = 0;
  for (const px of [bounds.minX, bounds.maxX]) {
    for (const pz of [bounds.minZ, bounds.maxZ]) {
      // Relative to the orbit centre, which is what the frame is centred on.
      const p = projectToView(frame, px - cx, 0, pz - cz, scratch);
      halfW = Math.max(halfW, Math.abs(p.px));
      halfH = Math.max(halfH, Math.abs(p.py));
    }
  }
  return { halfW, halfH };
}

/**
 * The wall fit: how far back the camera sits to frame this footprint.
 *
 * `allReal` is false when any room in the shot fell back to entity anchors,
 * which loosens the fraction for the whole shot — the fallback is per room, so
 * one room without a polygon only loosens ITS contribution to the box, but the
 * box it produced is the one being framed.
 */
export function wallFit(args: {
  bounds: Footprint;
  alpha: number;
  beta: number;
  vHalf: number;
  hHalf: number;
  allReal: boolean;
}): WallFit {
  const { bounds, alpha, beta, vHalf, hHalf, allReal } = args;
  const direction = viewDirection(alpha, beta);
  const { halfW, halfH } = projectedHalfExtents(bounds, direction);
  const fraction = allReal
    ? ROOM_FIT_VIEWPORT_FRACTION
    : ROOM_FIT_VIEWPORT_FRACTION_ENTITIES;
  const radius = Math.max(
    halfW / Math.tan(hHalf),
    halfH / Math.tan(vHalf),
    MIN_ROOM_FIT_RADIUS,
  ) / fraction;
  return {
    radius,
    halfW,
    halfH,
    direction,
    target: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: bounds.floorY,
      z: (bounds.minZ + bounds.maxZ) / 2,
    },
    fraction,
  };
}
