// src/babylon/badgeLook.ts
// A CARD-STYLE MAP BADGE'S FRAME, decided once — for every path that draws
// one: the lone card (EntityVisuals.updateLabel), the chips of a group's
// summary card and the sub-cards around them (updateEntityGroups), and the
// room chips (renderChips).
//
// ⚠️ FOUR PATHS DECIDED IT FOUR WAYS (round 8, 2.496.136). A lone card drew
// its ring as a Rectangle at `ringThicknessPx`, a group's chip BAKED one at a
// fraction of its size (≈1.3 px where the card beside it drew 3), the
// sub-cards and room chips wrote `ringRed ? ringThicknessPx : 1` each for
// itself; the corner was `chip.radius` (0.2826) on a lone card and 0.28
// everywhere else; the group chips computed their own bake size; the dash
// rule was the caller's to multiply out. Each of the last badge fixes
// (2.496.130–135) corrected one path while another kept its own rule.
//
// The classic "icon" style keeps its own, older rule (a ring baked at a small
// fraction of the badge — see badgeIcons.CLASSIC_RING) — a different style,
// named as such, not a second opinion on this one.
//
// PURE and import-free, so the oracles and badgeCard can read it.
// tests/oracles/badge_look.mjs.

/** The corner rounding of every badge, card and chip: the stylesheet's
 *  --chip-radius over --chip-size (13 / 46). */
export const BADGE_CORNER_FRACTION = 13 / 46;

/** A card's chip is baked this far inside its control, so the card shows
 *  round it (the ink inset `cardStruts` measures from). */
export const BADGE_INSET_CARD = 0.10;

/** The margin to the right of a card's value, in multiples of the icon's
 *  side padding — see badgeMetrics / badgeCard.cardStruts. */
export const CARD_VALUE_MARGIN_OF_ICON_PAD = 1.5;

/** The dashed (unavailable) ring's pattern, as multiples of its weight. */
export const RING_DASH: readonly [number, number] = [1.1, 0.9];

/** What a surface says about its ring (EntityCategories.categorySurface). */
export interface RingSurface { ring?: string | null; ringHairline?: boolean; ringDashed?: boolean }

export interface BadgeRing {
  /** Stroke weight in CSS px; 0 for no ring. */
  px: number;
  /** [on, off] in CSS px for a dashed ring; null for a solid one. */
  dash: [number, number] | null;
  color: string;
}

/**
 * A card-style badge's ring at a badge `sizePx` tall: a 1 px hairline at rest,
 * the card's state weight (`ringThicknessPx` at `cardHeightPx`, in proportion
 * for a smaller chip) when active, alerting or unavailable, dashed for the
 * last. The one answer for the Rectangle-drawn and the baked rings alike.
 */
export function badgeRing(
  surface: RingSurface, sizePx: number, m: { ringThicknessPx: number; cardHeightPx: number },
): BadgeRing {
  const px = !surface.ring ? 0 : surface.ringHairline ? 1 : m.ringThicknessPx * (sizePx / m.cardHeightPx);
  return {
    px,
    dash: surface.ringDashed && px > 0 ? [px * RING_DASH[0], px * RING_DASH[1]] : null,
    color: surface.ring ?? "transparent",
  };
}

/** A control that shows no ring (the classic style's hit target). */
export const NO_RING: BadgeRing = { px: 0, dash: null, color: "transparent" };

/** A control a badge frame is applied to: a Babylon Rectangle, or a
 *  DashableRectangle, which also takes the dash. */
export interface FrameTarget { thickness: number; color: string; cornerRadius: number; dash?: number[] | null }

/**
 * Put a frame on a control `sizePx` tall: its ring's weight, dash and colour,
 * and the badge corner at that size. ONE place for all three card-style paths
 * (the lone card, a group's sub-cards, a room chip) — they each wrote these
 * fields themselves, each with its own corner basis (round 9, 2.496.146).
 */
export function applyBadgeFrame(c: FrameTarget, ring: BadgeRing, sizePx: number): void {
  c.thickness = ring.px;
  c.color = ring.color;
  c.cornerRadius = sizePx * BADGE_CORNER_FRACTION;
  if (c.dash !== undefined) c.dash = ring.dash;
}

/**
 * The size a badge bitmap must be BAKED at, in render px, for one DRAWN at
 * `drawnPx` CSS px: every control is built in base CSS px and its container
 * scaled, so a control 22 wide covers 22·s render px — baking at 22 blurred
 * every retina badge. The far-zoom factor is left out on purpose: it moves
 * continuously and is capped at 1, so leaving it out can only bake larger.
 */
export function badgeBakePx(drawnPx: number, userScale: number, cssToGui: number): number {
  return drawnPx * userScale * cssToGui;
}
