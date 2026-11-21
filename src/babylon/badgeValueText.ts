// src/babylon/badgeValueText.ts
// The text a badge's value line reads: a device group's primary joined with its members' readings, and any value cut to
// what the label container can draw.
//
// ⚠️ ITS OWN MODULE (code-quality plan, phase 3, 2026-11-21): it was two private methods of the 5,900-line scene layer
// (groupedValue, clampToLabelWidth), reachable by no test, though the width it reserves is what the placement solver
// groups on. EntityVisuals reads the live states and the group; the joining and the cut are here, checked by value
// (tests/oracles/badge_value_text.mjs).
//
// PURE: no Babylon import.

import type { BadgeMetrics } from "./badgeMetrics";
import { cardStruts } from "./badgeCard";
import { glyphDrawPx } from "./badgeLayout";

/** What sits between two readings of one group's badge ("24°C  ·  58%"). */
export const GROUP_VALUE_SEPARATOR = "  ·  ";

/**
 * Truncate value text to what the label container can actually DRAW.
 *
 * Derived, not guessed: the ceiling is `labelMaxWidthPx` and the per-character advance is the one `labelBoxes` measures
 * the very same string with, so the width the solver reserves and the width the renderer draws agree by construction
 * rather than by a constant that happens to be big enough.
 */
export function clampToLabelWidth(text: string, m: BadgeMetrics, card: boolean): string {
  // A card's fixed part is cardStruts' — the one width model; the older
  // `cardPadLeftPx + cardHeightPx + cardValuePadPx` it retired survived here alone (round 8).
  const st = card ? cardStruts(m.cardHeightPx, glyphDrawPx(m, true), 1) : null;
  const fixed = st ? st.width - st.value : m.pillValuePadPx;
  const charPx = card ? m.cardValueCharPx : m.pillValueCharPx;
  if (!(charPx > 0)) return text;
  const max = Math.max(1, Math.floor((m.labelMaxWidthPx - fixed) / charPx));
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/**
 * A device-group PRIMARY's value line: its own reading, then each member's non-empty one (a temp+humidity combo shows
 * "24°C  ·  58%" on its one badge), cut to the container's width.
 *
 * ⚠️ THE JOIN IS CLAMPED, NOT JUST EACH PART. clampPill bounds a single value at 16 characters for tidiness; nothing
 * bounded the JOIN, which grows at 21N-5 characters for an N-member group. labelBoxes then reserved that full width
 * while the container could never draw past labelMaxWidthPx — ~384 CSS px reserved against 180 drawn at three members
 * (/dry-audit 2.423.0). Two different questions, so both clamps stay: one keeps a value tidy, this one keeps the model
 * honest. A badge that is no group's primary never comes here: its value passes through as compactValue made it.
 */
export function groupValueText(
  primaryValue: string, memberValues: readonly string[], m: BadgeMetrics, card: boolean,
): string {
  const parts = primaryValue ? [primaryValue] : [];
  for (const v of memberValues) if (v) parts.push(v);
  return clampToLabelWidth(parts.join(GROUP_VALUE_SEPARATOR), m, card);
}
