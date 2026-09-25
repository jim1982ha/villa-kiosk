// src/babylon/badgeScale.ts
// The badge layout's scale for a frame: pixels per world metre (the RUNG),
// the icon zoom derived from it, and the depth the rung is true at.
//
// ⚠️ SIX SHALLOW METHODS SHARED THIS KNOWLEDGE, AND IT BROKE AT THE JOINS.
// The same rung produced two zooms (0ea51b40, 2dd5a333) while the zoom was
// computed from the raw camera radius and not from the rung; a lattice walker
// used Math.round where the renderer used Math.ceil (2.425.0); render and CSS
// pixels were mixed across frames and killed a room's focus (c3367bcd); the
// reference depth drifted from the rung (d5090200). Each fix restated the rule
// at its own site. These are the rules, once:
//  * the rung is CEILED onto the zoom lattice — never below the drawn zoom, so
//    grouping can only ever be late, never early;
//  * the icon zoom is a function of the RUNG, so two frames at one rung give
//    one layout;
//  * the reference depth is the rung's inverse, so the depth correction
//    (badgeLayout.depthPull) is measured against the plane it corrects.
// Pure: tests/oracles/badge_scale.mjs.

import { snapToZoomLattice, ICON_ZOOM_EXPONENT, ICON_ZOOM_MIN_SCALE } from "./badgeMetrics";

/** Unquantised pixels per world metre at `dist`, for a viewport `vpH` pixels
 *  high whose half vertical field of view has tangent `tanHalf`. */
export function pxPerWorldAt(vpH: number, tanHalf: number, dist: number): number {
  return vpH / (2 * dist * tanHalf);
}

/** The rung at `dist`: pixels per metre, CEILED onto the zoom lattice. 0 when
 *  the frame cannot say (no height, no distance). Every walker of the lattice
 *  asks this — the renderer's rung and the room-zoom solver's search. */
export function rungAt(vpH: number, tanHalf: number, dist: number): number {
  if (!(dist > 0) || !(vpH > 0) || !(tanHalf > 0)) return 0;
  const raw = pxPerWorldAt(vpH, tanHalf, dist);
  return raw > 0 ? snapToZoomLattice(raw) : 0;
}

/** The depth at which `pxPerWorld` is exactly true — the rung's inverse. */
export function referenceDepthAt(vpH: number, tanHalf: number, pxPerWorld: number): number {
  if (!(pxPerWorld > 0) || !(tanHalf > 0) || !(vpH > 0)) return 0;
  return vpH / (2 * pxPerWorld * tanHalf);
}

/**
 * The icon zoom for a rung: badges keep their size at the whole-villa fit and
 * closer, and shrink (to ICON_ZOOM_MIN_SCALE at most) once zoomed OUT past it,
 * so a far view cannot pile every badge into one blob. A function of the RUNG,
 * never of the raw camera radius, and snapped onto the same lattice — one rung,
 * one zoom. `fitRadius` 0 (the walking camera) means no shrink.
 *
 * Render pixels on both sides of the ratio; it cancels, so this is independent
 * of the resolution valve — and quantising against a CSS-pixel rung here would
 * reopen the offset-lattice bug through the other door.
 */
export function iconZoomAt(rung: number, vpH: number, tanHalf: number, fitRadius: number): number | null {
  if (!(fitRadius > 0)) return 1;
  const atFit = pxPerWorldAt(vpH, tanHalf, fitRadius);
  if (!(atFit > 0) || !(rung > 0)) return null;
  const ratio = Math.pow(rung / atFit, ICON_ZOOM_EXPONENT);
  return snapToZoomLattice(Math.min(1, Math.max(ICON_ZOOM_MIN_SCALE, ratio)));
}

/** The viewport height a rung is measured in. RENDER pixels within a frame
 *  (the boxes it is compared with are render pixels too); CSS pixels for any
 *  value compared ACROSS frames, because the resolution valve moves the render
 *  height every time the camera starts and stops (c3367bcd). */
export function viewportPx(renderHeight: number, hwScale: number, cssPixels: boolean): number {
  return cssPixels ? renderHeight * hwScale : renderHeight;
}
