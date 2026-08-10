// src/config/chipProportions.ts
// ONE definition of the icon chip's proportions, for the two renderers that
// draw it: the DOM (the bottom bar's `.summary-tile-icon`) and Babylon (the
// map badge, which cannot reach CSS and works in fractions instead).
//
// ── Why this exists ────────────────────────────────────────────────────────
// The bottom bar and the map badge are the same component — a category-
// coloured rounded square holding a glyph, with a label or a value beside it —
// and for a long stretch they were two independent sets of numbers. The DOM
// side was right, because it is easy to see and easy to adjust. The Babylon
// side accumulated a glyph size derived from a ring thickness, a padding that
// was a constant sitting next to a height it had no relationship with, and a
// gap picked to look about right. Across 2.232.0-2.245.0 every one of those
// was reported as a rendering fault, and every one already had an answer in
// `.summary-tile-icon`'s three declarations.
//
// So the tokens live in styles.css, once, and this reads them. The map works
// in PROPORTIONS of the chip rather than its pixels, which is what lets a 46px
// bottom-bar tile and a 22px map badge be recognisably the same object at
// completely different sizes.
//
// Fallbacks match the stylesheet exactly and matter for more than tidiness:
// this can be called before the stylesheet has applied, and a wrong number
// there is a badge drawn at the wrong proportions on the first frame.

import { cssVar } from "./EntityCategories";

/** The stylesheet's own values, and the fallback if a token is unreadable. */
const FALLBACK = { size: 46, glyph: 24, gap: 13, radius: 13 } as const;

function token(name: string, fallback: number): number {
  const raw = cssVar(name);
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface ChipProportions {
  /** Glyph size as a fraction of the chip. */
  glyph: number;
  /** Gap from the chip to its label/value, as a fraction of the chip. */
  gap: number;
  /** Corner radius as a fraction of the chip. */
  radius: number;
}

/**
 * Read the chip tokens and reduce them to fractions.
 *
 * Resolved once per badge rebuild rather than cached at module load: a theme
 * switch re-reads the same custom properties, and the badge layer already
 * rebuilds on that path.
 */
export function chipProportions(): ChipProportions {
  const size = token("--chip-size", FALLBACK.size);
  return {
    glyph: token("--chip-glyph", FALLBACK.glyph) / size,
    gap: token("--chip-gap", FALLBACK.gap) / size,
    radius: token("--chip-radius", FALLBACK.radius) / size,
  };
}
