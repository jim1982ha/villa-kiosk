// src/babylon/placementCheck.ts
//
// THE PLACEMENT ORACLE — does what got PAINTED break the rules?
//
// ⚠️ THIS IS A PROPERTY TEST THAT USED TO LIVE IN THE RENDER LOOP. 300 lines of
// pairwise checks inside a 9,858-line Babylon class, reachable only on a device,
// only under `?debug=place`, only while a human was looking. The repo had
// already written the test for the subsystem it has rewritten six times; it
// could not run it.
//
// ⚠️ IT SHARES NO ARITHMETIC WITH THE SOLVER, AND THAT IS THE ONLY REASON IT
// CAN DISAGREE WITH IT. The boxes handed in are measured from the TRUE
// perspective projection the GUI layer draws through — not from the solver's
// orthographic view plane at the quantised rung. An earlier version fed the
// solver's own items back into the solver's own predicate, which is a tautology:
// it could not fail whatever the screen looked like, and for as long as it
// existed it reported a clean layout over screenshots full of badges drawn on
// top of each other. An assertion that restates its subject's own conclusion is
// worse than no assertion, because it is read as evidence.
//
// ⚠️ EVERY CATEGORY IS BUCKETED, NEVER DROPPED. Three counters in this file's
// history reported 0 for the exact case they existed to see, because an
// "expected" pair was `continue`d instead of labelled. If a category is
// expected, LABEL it.
//
// ⚠️ IMPORTS NOTHING AT RUNTIME. The projection stays with the renderer, which
// is deliberate: Babylon's own `Vector3.Project` is what makes the input
// independent of the solver, and transcribing it here would make this oracle
// depend on our arithmetic instead of the engine's — less independence, not
// more.

/** A drawn thing, in RENDER pixels. Commensurable by construction: the
 *  projection works in the global viewport and `effectiveScale` carries
 *  `cssToGui`, so boxes and card layouts are already in the same space. */
export interface ScreenBox {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

/** Ink on ink. No gap, no minimum pitch, no tolerance: two things either cover
 *  the same pixels or they don't, and that is the one claim about this
 *  subsystem nobody can argue with from a screenshot. */
export function hits(a: ScreenBox, b: ScreenBox): boolean {
  return Math.abs(a.cx - b.cx) < a.hw + b.hw
      && Math.abs(a.cy - b.cy) < a.hh + b.hh;
}

export interface ViewportRect { x: number; y: number; width: number; height: number }

/** Off-screen overlap is not something anyone sees. */
export function onScreen(b: ScreenBox, vp: ViewportRect): boolean {
  return b.cx + b.hw >= vp.x && b.cx - b.hw <= vp.x + vp.width
      && b.cy + b.hh >= vp.y && b.cy - b.hh <= vp.y + vp.height;
}

/** What the renderer actually painted, already projected and culled. */
export interface PaintedScene {
  badges: readonly ScreenBox[];
  /** Per badge: is its room focused? A focused badge's overlap is DELIBERATE
   *  (the exemption stacks them, which is why pairFocusedRoom exists). */
  badgeExempt: readonly boolean[];
  /** A card's full drawn box. */
  cards: readonly ScreenBox[];
  /** The square INSCRIBED in each card — "is this badge under my ink", which
   *  is a different question from "do we clear each other". */
  cardInk: readonly ScreenBox[];
  cardFocused: readonly boolean[];
  chips: readonly ScreenBox[];
  /** The accessibility tap pitch, in render px. */
  minSepPx: number;
}

/**
 * Every counter, in one pass.
 *
 * ⚠️ THE SPLITS ARE THE POINT. `overhung` is expressly allowed (a card MAY be
 * drawn over a badge outside its ink); `buried` is a MEASUREMENT of the
 * orthographic-vs-perspective residual, not a violation; focused pairs never
 * went through `fits`. A single undifferentiated counter would be permanently
 * non-zero for a documented reason, and a permanently non-zero assertion is a
 * disabled one.
 */
export interface PlacementCounts {
  /** Drawn badge over drawn badge. The headline number. Must be 0. */
  overlaps: number;
  /** Clear, but closer than the tap pitch. Counted separately because it is a
   *  tap-target rule, not a legibility one. */
  tooClose: number;
  /** Overlaps inside the focused room. Expected — pairFocusedRoom's leftovers. */
  focusOverlaps: number;
  /** A badge under a card's INK. A measurement, not a violation. */
  buried: number;
  /** A badge under a card's overhang. Allowed by design. */
  overhung: number;
  /** Badge/card overlaps involving a focused object. Expected. */
  focusCardHits: number;
  /** Card over card, both through `fits`. */
  summaryOverlaps: number;
  /** Card over card, at least one focused. Expected. */
  summaryFocusOverlaps: number;
  /** Anything over a room chip — the tier of last resort. */
  chipHits: number;
  /** …involving a focused object. One frame is the residual; persistent is a
   *  gap in settleChips' focus drop. */
  chipHitsFocused: number;
  /** Chip over chip — the merge failing to reach a fixpoint. */
  chipPairs: number;
}

export function checkPlacement(scene: PaintedScene): PlacementCounts {
  const { badges, badgeExempt, cards, cardInk, cardFocused, chips, minSepPx } = scene;
  const c: PlacementCounts = {
    overlaps: 0, tooClose: 0, focusOverlaps: 0,
    buried: 0, overhung: 0, focusCardHits: 0,
    summaryOverlaps: 0, summaryFocusOverlaps: 0,
    chipHits: 0, chipHitsFocused: 0, chipPairs: 0,
  };

  // (a) Drawn badge vs drawn badge.
  for (let i = 0; i < badges.length; i++) {
    for (let j = i + 1; j < badges.length; j++) {
      const a = badges[i], b = badges[j];
      const ink = hits(a, b);
      if (badgeExempt[i] || badgeExempt[j]) { if (ink) c.focusOverlaps++; continue; }
      if (ink) c.overlaps++;
      else if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < minSepPx) c.tooClose++;
    }
  }

  // (b) Drawn badge vs summary card.
  for (let k = 0; k < cards.length; k++) {
    for (let i = 0; i < badges.length; i++) {
      const ink = hits(cardInk[k], badges[i]);
      if (!ink && !hits(cards[k], badges[i])) continue;
      // A focused card never went through `fits`, and a focused badge blocks
      // nobody — so neither is a violation. Still counted, so the number exists.
      if (cardFocused[k] || badgeExempt[i]) { c.focusCardHits++; continue; }
      if (ink) c.buried++; else c.overhung++;
    }
  }

  // (c) Summary vs summary.
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (!hits(cards[i], cards[j])) continue;
      if (cardFocused[i] || cardFocused[j]) c.summaryFocusOverlaps++;
      else c.summaryOverlaps++;
    }
  }

  // (d) Room chip vs everything the chip outranks.
  for (const chip of chips) {
    for (let i = 0; i < badges.length; i++) {
      if (!hits(chip, badges[i])) continue;
      if (badgeExempt[i]) c.chipHitsFocused++; else c.chipHits++;
    }
    for (let k = 0; k < cards.length; k++) {
      if (!hits(chip, cards[k])) continue;
      if (cardFocused[k]) c.chipHitsFocused++; else c.chipHits++;
    }
  }

  // (e) Chip vs chip.
  for (let i = 0; i < chips.length; i++) {
    for (let j = i + 1; j < chips.length; j++) {
      if (hits(chips[i], chips[j])) c.chipPairs++;
    }
  }

  return c;
}
