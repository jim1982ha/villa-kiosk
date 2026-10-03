// src/babylon/badgeBox.ts
// HOW MUCH ROOM A BADGE NEEDS on the screen, with or without its value — the
// one definition the placement pass, the room chips and "zoom to this room"
// all measure with. Pure: tests/oracles/badge_box.mjs drives it by value.
//
// ⚠️ THE DECISION WAS STORED IN THE GUI AND READ BACK (until 2.496.269).
// Whether a badge shows its value is a LAYOUT decision (the pass drops a
// crowded badge's readout before it tests grouping), but it lived only in the
// Babylon control (`valueWrap.isVisible`) and the box maths read it back out —
// so "zoom to this room" had to hide every member's value, measure, and put
// the old visibility back, and none of it could be tested without a scene.
// The pass now owns a `valueShown` answer per badge and writes the controls
// FROM it; the box is a function of that answer.

import { cardStruts } from "./badgeCard";
import { glyphDrawPx } from "./badgeLayout";
import type { BadgeMetrics } from "./badgeMetrics";
import { VALUE_CAPABLE_TYPES } from "@/utils/entityValue";

/** A badge's collision box in screen px, relative to its anchor point. */
export interface BadgeBox { halfW: number; halfH: number; cy: number }

/** What a badge's size depends on. */
export interface BadgeBoxInput {
  /** The card style (one horizontal card) rather than the classic round badge. */
  card: boolean;
  /** The mapping type — whether a classic badge can EVER carry a value pill. */
  type: string;
  /** Characters in its value text. */
  valueChars: number;
  /** Whether the value is drawn (the pass's answer, not the control's state). */
  valueShown: boolean;
}

/**
 * The box of one badge at `scale` (zoom × user size × CSS→GUI), filled into
 * `out` (the render loop reuses its buffers; no allocation per frame).
 *
 * Card: the card IS the container, hanging above the anchor; width is the
 * renderer's own struts (badgeCard.cardStruts) around the glyph and any value.
 * Classic: the round badge, its pill under it. The HEIGHT reserves the pill for
 * any type that can ever grow one, so two neighbours keep their spacing whichever
 * of them happens to have a reading right now; only the width follows the text.
 */
export function badgeBox(b: BadgeBoxInput, m: BadgeMetrics, scale: number, out: BadgeBox = { halfW: 0, halfH: 0, cy: 0 }): BadgeBox {
  if (b.card) {
    const valW = b.valueShown ? b.valueChars * m.cardValueCharPx : 0;
    const cardW = cardStruts(m.cardHeightPx, glyphDrawPx(m, true), valW).width;
    out.halfW = (cardW / 2) * scale;
    out.halfH = (m.cardHeightPx / 2 + 1) * scale;
    out.cy = -(m.cardHeightPx / 2) * scale;
    return out;
  }
  const pillCapable = (VALUE_CAPABLE_TYPES as ReadonlySet<string>).has(b.type);
  const pillHalfW = b.valueShown ? (b.valueChars * m.pillValueCharPx + m.pillValuePadPx) / 2 : 0;
  out.halfW = Math.max(m.badgeDiameterPx / 2, pillHalfW) * scale;
  out.halfH = (pillCapable ? m.classicHalfHWithPillPx : m.classicHalfHPx) * scale;
  out.cy = (pillCapable ? m.classicCyWithPillPx : m.classicCyPx) * scale;
  return out;
}

/** The values a placement pass starts with: every badge that has text shows it. */
export function valuesWithText(chars: readonly number[], out: boolean[] = []): boolean[] {
  out.length = chars.length;
  for (let i = 0; i < chars.length; i++) out[i] = chars[i] > 0;
  return out;
}

/** Tier 1 → 2: a badge whose box touches another's drops its value — the tap
 *  target never yields, the readout does (it is one tap away in the panel). */
export function dropTouchingValues(shown: boolean[], touching: ArrayLike<boolean | number>): boolean[] {
  for (let i = 0; i < shown.length; i++) if (touching[i]) shown[i] = false;
  return shown;
}
