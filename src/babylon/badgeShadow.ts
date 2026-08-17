// src/babylon/badgeShadow.ts
// The drop shadow under anything the badge layer draws — badge, summary card,
// room chip, value pill — in ONE place, for the same reason `badgeText.ts`
// exists: several properties that have to be set identically on every control,
// where missing one is invisible to `tsc` and to review.
//
// ── TWO FACTS, AND BOTH WERE WRITTEN ON ONLY ONE OF THE FOUR CONTROLS ───────
//
// 1. A CANVAS SHADOW DOES NOT RIDE THE CTM. `shadowBlur`/`shadowOffsetX/Y` are
//    applied in DEVICE pixels whatever the container's scale, which makes them
//    the one badge dimension that must NOT live in `badgeMetrics.ts` (that file
//    is CSS pixels, converted through `effectiveScale()` — see CLAUDE.md). A
//    blur written there would be scaled twice on a retina panel and once here.
//
// 2. A BADGE FLOATING OVER A 3D VILLA HAS NO LIGHT SOURCE, so its shadow is a
//    HALO, not a skirt. The reasoning, from the badge's own comment: a 2px
//    downward offset is a fixed band of extra dark under the card at every
//    zoom; on a dark badge over a bright floor that band reads as part of the
//    badge, making it look taller at the bottom than the top and its contents
//    look high — an optical offset no amount of centring the CONTENTS can
//    answer, because the contents were already centred. A directional drop
//    shadow is a DOM idiom borrowed from a surface that HAS a light source.
//
// /dry-audit (2026-08-17) found fact 2 stated on the badge and ignored by two
// of the other three: the summary card's cells and the room chip both carried
// `shadowOffsetY = 2`, drawn on the same glass, at the same moment, beside
// badges that did not. Five agreements that happened to match with nothing for
// the sixth reader to join is the exact shape this repo keeps paying for, so
// the rule is a function now and the offset is not a parameter — a caller gets
// it by CALLING, not by remembering.

import type { Control } from "@babylonjs/gui/2D/controls/control";

/**
 * The three tiers, with the colour and blur each one was ALREADY using.
 *
 * ⚠️ The three colours are undocumented DRIFT and are deliberately NOT unified
 * here. Nothing said why a card cell is lighter than a badge, and darkening
 * three surfaces is a visual change nobody asked for — the defect /dry-audit
 * found was the OFFSET, which had a written rule and two violations. Collecting
 * the values in one place is what makes the drift visible; deciding it is a
 * separate, deliberate act. If they should be one colour, that is one edit here
 * and a screenshot.
 */
const TIERS = {
  /** The individual badge — where both rules below were written down. */
  badge: { color: "rgba(0,0,0,0.55)", blur: 6 },
  /** The classic style's value chip: a small stadium under its badge, on its
   *  own dark fill, with a tighter halo. */
  pill: { color: "rgba(0,0,0,0.5)", blur: 4 },
  /** The larger surfaces drawn beside badges — a summary card's cells and a
   *  room chip. Both carried the same lighter colour independently. */
  surface: { color: "rgba(0,0,0,0.4)", blur: 6 },
} as const;

export type BadgeShadowTier = keyof typeof TIERS;

/**
 * Apply the badge layer's shadow to a control.
 *
 * There is deliberately NO offset parameter: the halo is even on every tier,
 * for the reason in fact 2 above. A caller gets that by CALLING rather than by
 * remembering, which is the whole point of this file existing.
 */
export function badgeShadow(control: Control, tier: BadgeShadowTier = "badge"): void {
  const t = TIERS[tier];
  control.shadowColor = t.color;
  control.shadowBlur = t.blur;
  // Both axes, explicitly. Leaving one unset relies on Babylon's default being
  // 0, which is true today and is not what this file is asserting: it asserts
  // that the halo is EVEN, and an assertion resting on a default is one nobody
  // can find when it stops holding.
  control.shadowOffsetX = 0;
  control.shadowOffsetY = 0;
}
