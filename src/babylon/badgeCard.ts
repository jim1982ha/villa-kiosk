// src/babylon/badgeCard.ts
// The geometry of a summary CARD — the control a group of badges collapses to
// when it can still show every one of its devices. Pure: no imports at all, in
// the same spirit as badgePlacement.ts and badgeMetrics.ts, which is what lets
// `npm run test:placement` cover it. This file's arithmetic is the easiest part
// of the subsystem to get wrong and there is no other way to guard it: nothing
// in the repo can exercise EntityVisuals without a browser.
//
// ── One unit, integer multiples ────────────────────────────────────────────
// A card is never given a size of its own. Its UNIT is the badge it stands in
// for, and every dimension is that unit times a small integer: the card is
// `cols x rows` units, each chip is `cardIconFraction` of a unit, and the
// margin at the card's edge and the gap between chips both fall out of that one
// fraction rather than being stated anywhere. Two past regressions came from
// letting a summary carry numbers of its own and watching them drift from the
// badges they replaced; derivation from one unit is what stops that recurring.
//
// ── Why the cap lives here ────────────────────────────────────────────────
// `MAX_GRID_CHIPS` is enforced by `gridLayout` itself, not by its callers. A
// card is one badge wide per column, so an unbounded chip count is an unbounded
// card: 2.261.0 let a producer ask for a whole pile and painted a single card
// the full width of the phone. A cap a caller has to remember is a cap that
// will eventually be forgotten by one of them.

/** The most device pictograms one card may show: a 2x2 grid.
 *
 *  Beyond this the summary is a count badge instead. Three columns would put
 *  each chip's tap zone under a badge's own box, and past four the number is
 *  the useful fact anyway — nobody reads six pictograms as "six". */
export const MAX_GRID_CHIPS = 4;

/** How many cells a group of `n` members actually draws. THE clamp — every
 *  measurement and every draw must go through it, or a card can be measured at
 *  one size and drawn at another, which is this subsystem's oldest bug. */
export function gridCells(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.floor(n), MAX_GRID_CHIPS));
}

export interface CardLayout {
  cols: number;
  rows: number;
  /** Card size in the same units as `unit` (i.e. badge units, pre-scale). */
  width: number;
  height: number;
  /** One pictogram's box. */
  chip: number;
  /** Centre-to-centre distance between cells, on both axes: one unit, so a
   *  cell IS a badge box and its tap zone is exactly the badge it replaces. */
  pitch: number;
  /** Cell centre offsets from the card's centre, for chip `k`. */
  cellLeft(k: number): number;
  cellTop(k: number): number;
  /** The same cell as a percentage of the card, for a hit zone. The zones TILE
   *  it — every point inside the card belongs to exactly one cell — which is
   *  what lets a zone be narrower than a slop-expanded badge without ever being
   *  ambiguous about which device a tap meant. */
  zonePct(k: number): { w: number; h: number; l: number; t: number };
}

/**
 * Lay out `n` chips.
 *
 *   n <= 2 → one row  (1x1, 2x1)
 *   n = 3, 4 → 2x2, filled ROW-MAJOR so cell 3 is bottom-right
 *
 * Row-major matters: it is what lets the first three devices keep their cells
 * when a fourth joins. Cells are assigned in the solver's own total order
 * (rank, then entity_id), so a device only moves when something that sorts
 * before it appears or disappears — the same stability argument the badges
 * themselves rest on.
 *
 * A 3-member card leaves its bottom-right cell EMPTY rather than centring the
 * odd chip, which would look tidier and would move all three every time the
 * fourth device came and went.
 */
export function gridLayout(n: number, unit: number, iconFraction: number): CardLayout {
  const cells = gridCells(n);
  const cols = cells <= 2 ? Math.max(1, cells) : 2;
  const rows = Math.max(1, Math.ceil(cells / cols));
  const width = cols * unit;
  const height = rows * unit;
  return {
    cols,
    rows,
    width,
    height,
    chip: Math.max(4, Math.round(unit * iconFraction)),
    pitch: unit,
    cellLeft: (k) => ((k % cols) - (cols - 1) / 2) * unit,
    cellTop: (k) => (Math.floor(k / cols) - (rows - 1) / 2) * unit,
    zonePct: (k) => ({
      w: 100 / cols,
      h: 100 / rows,
      l: (((k % cols) - (cols - 1) / 2) * 100) / cols,
      t: ((Math.floor(k / cols) - (rows - 1) / 2) * 100) / rows,
    }),
  };
}
