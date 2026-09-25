// src/babylon/badgeLayout.ts
// The geometry a badge brings to placement: where it is on the glass, how much
// room it claims there, and the sizes its glyph is drawn and baked at.
//
// ⚠️ THE PURE PARTS OF THE BADGE PIPELINE WERE TESTED; THE GLUE WAS NOT. Seven
// of EntityVisuals' last ten fixes landed in the private code between the
// tested modules — a bake at the unscaled size (the glyph blur), two widths
// for one card, the depth pull — and the oracles could only read that code's
// SOURCE or restate its formula (depth_residual.mjs copied the depth pull by
// hand). This module is that glue for one badge, with nothing in it that
// needs a scene: EntityVisuals feeds it, and the oracles call it.
//
// Every number crossing this interface is in GUI pixels at the rung, except
// the two glyph sizes, which say which side of the container's scale they are
// on in their names.

import { projectToView, type ViewBasis } from "./badgeProjection";
import type { BadgeMetrics } from "./badgeMetrics";

/** What one pass measures with — see EntityVisuals.screenClearance. */
export interface GlassClearance {
  /** The rung's quantised pixels per world unit. */
  pxPerWorld: number;
  /** 1 − the blanket overlap allowance (0 since 2.173.0, and staying there). */
  allow: number;
  basis: ViewBasis;
  /** The rung's reference depth, 0 when unknown (no correction then). */
  refDepth: number;
}

/** A badge's drawn box, from labelBoxes: half extents and how far above its
 *  anchor it hangs. */
export interface DrawnBox { halfW: number; halfH: number; cy: number }

/** Where a badge is on the glass and the room it claims there. */
export interface OnGlass { sx: number; sy: number; sz: number; reach: number; reachY: number }

/**
 * How much more room a badge must claim because of its OWN depth.
 *
 * Placement measures on an orthographic plane at one pixels-per-world for the
 * whole scene; the renderer divides every drawn thing by its own depth. So two
 * badges further than the reference depth DRAW CLOSER TOGETHER than the plane
 * predicted, by the ratio of the depths — the far side of the villa is where
 * badges were reported sitting on each other.
 *
 * ⚠️ ONE-SIDED, clamped at 1. A badge NEARER than the reference draws further
 * apart than predicted; shrinking its claim would group it late. And NOT the
 * blanket margin GROUP_OVERLAP_ALLOW_WIDTHS, which made everything merge
 * earlier: this asks each badge for exactly what its depth costs it.
 */
export function depthPull(refDepth: number, pd: number): number {
  return refDepth > 0 ? Math.max(1, (refDepth + pd) / refDepth) : 1;
}

/**
 * One badge, on the glass. Projects its anchor ONCE — every distance the
 * solver computes inherits it — and centres the box where it is DRAWN, not on
 * the anchor: a badge hangs `cy` above its anchor, by an amount that depends
 * on its own state (56 CSS px without a value readout, 45.5 with one), so two
 * neighbours level at their anchors are not level on screen. A layout decision
 * may never use different geometry from the renderer — for position as well
 * as size (2.287.0).
 *
 * `scratch` is the projection's output buffer, reused across a pass.
 */
export function onGlass(
  c: GlassClearance,
  wx: number, wy: number, wz: number,
  box: DrawnBox,
  scratch: { px: number; py: number; pz: number; pd: number },
  out: OnGlass,
): OnGlass {
  const p = projectToView(c.basis, wx, wy, wz, scratch);
  const k = c.pxPerWorld;
  out.sx = p.px * k;
  out.sy = p.py * k + box.cy;
  out.sz = p.pz * k;
  const pull = depthPull(c.refDepth, p.pd);
  out.reach = box.halfW * c.allow * pull;
  out.reachY = box.halfH * c.allow * pull;
  return out;
}

/**
 * The size a badge's glyph is DRAWN at, in base (unscaled) CSS px. One
 * expression for the control's width and the bake's source, because their
 * agreeing is what stopped WebKit's single bilinear tap staircasing it
 * (2.301.0). A card's glyph fits its WORST-CASE inner box — inset by the
 * heaviest ring — so it cannot clip while the device is active or alerting.
 */
export function glyphDrawPx(m: BadgeMetrics, card: boolean): number {
  if (!card) return m.badgeDiameterPx;
  const cardMaxInnerH = m.cardHeightPx - 2 * m.ringThicknessPx;
  return Math.min(Math.round(m.cardHeightPx * m.cardIconFraction), cardMaxInnerH);
}

/**
 * The size a glyph's bitmap must be BAKED at, in RENDER px — not
 * `glyphDrawPx`. Every control is built in base CSS px and the container is
 * then scaled, so a control 44 wide covers 44·s render pixels; baking at 44
 * upscaled the artwork 2x on every retina device (the "icons are very low
 * resolution" report, iPad and iPhone). `cssToGui` is the device's BEST
 * conversion, and the far-zoom factor is deliberately absent: it moves
 * continuously and is capped at 1, so leaving it out can only bake larger.
 */
export function glyphBakePx(m: BadgeMetrics, card: boolean, userScale: number, cssToGui: number): number {
  return glyphDrawPx(m, card) * userScale * cssToGui;
}
