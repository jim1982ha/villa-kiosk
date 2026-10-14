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
//    (badgeLayout.depthPull) is measured against the plane it corrects;
//  * the rung is quantised in CSS px and only then converted to render px
//    (rungPx) — so the layout is the same at every render resolution.
//
// ⚠️ "BADGES REGROUP WHILE THE MOUSE MOVES" (owner, three reports to 2.496.345).
// The rung was ceiled in RENDER px. The resolution valve draws at one scale
// while the camera moves and sharper once it is still, and ceil does not
// commute with a scale that is not a power of two: snap(raw·c)/c moved by up to
// one lattice step (5.9%) between the two, enough to tip a room sitting at its
// grouping threshold — a chip when still, its devices while moving. Measured in
// CSS px, the rung cannot know the valve exists.
// Pure: tests/oracles/badge_scale.mjs, tests/oracles/hover_no_regroup.mjs.

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

/** The layout's rung in RENDER px: the CSS-px rung (`cssH`, the viewport's CSS
 *  height) times `cssToGui` (render px per CSS px). Every pass and the room-zoom
 *  solver ask this — see the header for why the order matters. */
export function rungPx(cssH: number, tanHalf: number, dist: number, cssToGui: number): number {
  return rungAt(cssH, tanHalf, dist) * cssToGui;
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
 * CSS pixels on both sides of the ratio: `rung` is the CSS-px rung (the one
 * rungPx scales), so the zoom and the positions come from one quantisation.
 */
export function iconZoomAt(rung: number, vpH: number, tanHalf: number, fitRadius: number): number | null {
  if (!(fitRadius > 0)) return 1;
  const atFit = pxPerWorldAt(vpH, tanHalf, fitRadius);
  if (!(atFit > 0) || !(rung > 0)) return null;
  const ratio = Math.pow(rung / atFit, ICON_ZOOM_EXPONENT);
  return snapToZoomLattice(Math.min(1, Math.max(ICON_ZOOM_MIN_SCALE, ratio)));
}

/** A viewport extent (height for the rung, width for "is this a phone") in CSS
 *  px — the one unit the resolution valve cannot move. The canvas's own CSS size
 *  when there is one (`cssPx`); without one (headless), rebuilt from the render
 *  size, rounding UP: Babylon's setSize TRUNCATES the render size, so
 *  `renderPx × hwScale` reads up to a pixel short (2.496.181: "the swimming pool
 *  icons collapse as soon as I move my mouse" — 50 of 12,020 window × zoom
 *  cases). Rounding up restores it exactly while hwScale ≤ 1. */
export function cssExtent(renderPx: number, hwScale: number, cssPx?: number): number {
  if (cssPx !== undefined && cssPx > 0) return cssPx;
  return Math.ceil(renderPx * hwScale - 1e-6);
}
