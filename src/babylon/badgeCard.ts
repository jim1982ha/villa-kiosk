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
// for, and every dimension is that unit times a small integer: a card is
// `cols x rows` units, each chip is `cardIconFraction` of a unit, and the
// margin at a card's edge and the gap between chips both fall out of that one
// fraction rather than being stated anywhere. Two past regressions came from
// letting a summary carry numbers of its own and watching them drift from the
// badges they replaced; derivation from one unit is what stops that recurring.
//
// ── Why a group of cards, and not one bigger grid ─────────────────────────
// Past four devices the arrangement adds a SECOND CARD beside the first rather
// than growing to a 3x2. A card of at most four stays a recognisable object —
// the same object a pair or a quad draws — where a 3x3 would be a third kind
// of thing. The cost is width, which is why the total is capped low: the
// clearance test between two summaries is a disc (direction would need the
// camera), so a wide arrangement claims a disc as wide as it is and escalates
// more rooms to their chip. See MAX_TOTAL_CHIPS.
//
// ── Why the caps live here ────────────────────────────────────────────────
// `arrange` clamps its own input. A card is one badge wide per column, so an
// unbounded cell count is an unbounded card: 2.261.0 let a producer ask for a
// whole pile and painted a single card the full width of the phone. A cap a
// caller has to remember is a cap that will eventually be forgotten by one of
// them.

/** The most device pictograms ONE card may show: a 2x2 grid.
 *
 *  Three columns would put each cell's tap zone under a badge's own box. */
export const MAX_GRID_CHIPS = 4;

/**
 * The same ceiling ON A PHONE, where a 2x2 is not a legible object.
 *
 * Reported from an iPhone: four ~30px pictograms in one card, every tap zone at
 * the touch minimum with no gap to its neighbour. At two the card is a single
 * ROW of two — `cols = take <= 2 ? take : 2` below gives rows = 1 — so a pile
 * of four becomes two pair-cards side by side rather than one 2x2, and nothing
 * is hidden and no number is drawn.
 */
export const PHONE_MAX_GRID_CHIPS = 2;

/**
 * The most pictograms an ARRANGEMENT may show across all its cards.
 *
 * Six — a 2x2 beside a 1x2 — and the number is set by the collision test, not
 * by taste. Two summaries must clear each other and that test is a disc, so an
 * arrangement claims a disc of its own diagonal: a 2x2 alone is 1.41 units,
 * this is about 1.8, and two full 2x2s side by side would be 2.24 — at which
 * point groups of five upward start failing to place and escalating their room
 * to a chip, which is the complaint this whole area exists to answer. Above
 * the cap the summary is a count badge, one unit square, which after the
 * absorb phase no longer costs its room a chip either.
 */
export const MAX_TOTAL_CHIPS = 6;

/**
 * How many cells a group of `n` members actually draws. THE clamp — every
 * measurement and every draw must go through it, or an arrangement can be
 * measured at one size and drawn at another, which is this subsystem's oldest
 * bug.
 *
 * ── Over the cap is ZERO, not the cap ─────────────────────────────────────
 * A summary hides every device it stands for. Returning `MAX_TOTAL_CHIPS` for
 * a pile of seven would therefore draw six of them and leave the seventh
 * hidden AND with no cell to tap — invisible and unreachable, the one outcome
 * this whole subsystem exists to prevent, and silent because six chips look
 * perfectly correct. Zero cells is the count badge, which stands honestly for
 * all seven. (`arrange` then lays the count out as its degenerate 1x1 card.)
 *
 * The producers used to spell this rule out themselves as
 * `n <= MAX_TOTAL_CHIPS ? n : 0`, and the third one — the absorb phase, which
 * grows a group's membership after the fact — did not, which is exactly how a
 * cap a caller has to remember gets forgotten.
 */
export function gridCells(n: number, max = MAX_TOTAL_CHIPS): number {
  if (!Number.isFinite(n)) return 0;
  const cells = Math.max(0, Math.floor(n));
  return cells > max ? 0 : cells;
}

export interface SubCard {
  /** Centre offset from the arrangement's centre, in units. */
  left: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** Global index of this card's first cell. */
  first: number;
  cells: number;
  /** Row offset from the arrangement's centre, in units. 0 for every
   *  arrangement up to MAX_TOTAL_CHIPS — those are one row wide — and non-zero
   *  only for the larger FOCUSED arrangements, which wrap (see `arrange`). */
  top: number;
}

export interface CardArrangement {
  cards: SubCard[];
  /** The whole arrangement, in the same units as `unit`. */
  width: number;
  height: number;
  /** One pictogram's box. */
  chip: number;
  /** Centre-to-centre distance between cells, on both axes: one unit, so a
   *  cell IS a badge box and its tap zone is exactly the badge it replaces. */
  pitch: number;
  /** Cells drawn, after clamping. 0 means a count badge. */
  cells: number;
  /** Cell centre offsets from the ARRANGEMENT's centre, in units. */
  cellLeft(k: number): number;
  cellTop(k: number): number;
  /** The cell's hit zone — one unit square, centred on its own chip. The zones
   *  TILE each card, so every point on a card belongs to exactly one device;
   *  the gap BETWEEN cards belongs to none, and a tap there falls through to
   *  whatever is underneath (see pickEntityGroupAt). */
  zoneW: number;
  zoneH: number;
}

/**
 * Lay out `n` chips as one or more cards.
 *
 *   n <= 2 → a single row  (1x1, 2x1)
 *   n = 3, 4 → one 2x2, filled ROW-MAJOR so cell 3 is bottom-right
 *   n = 5, 6 → a 2x2 plus a second card holding the rest, side by side
 *   n >= 7 → zero cells: the caller draws a count on the degenerate 1x1 card
 *
 * Cards are filled GREEDILY — four, then the remainder — so a device keeps its
 * CELL WITHIN ITS CARD when another joins. It does not keep its absolute
 * position: the arrangement is centred, so a second card shifts the first one
 * left by half its width. That is the honest claim; the stronger one is false.
 *
 * A 3-member card leaves its bottom-right cell EMPTY rather than centring the
 * odd chip, which would look tidier and would move all three every time the
 * fourth device came and went.
 */
export function arrange(
  n: number, unit: number, iconFraction: number, gap: number,
  /** The cell ceiling to clamp against. Defaults to MAX_TOTAL_CHIPS, which is
   *  set by the summary-vs-summary clearance test — see that constant. A
   *  FOCUSED group passes a larger one, because it is seated unconditionally
   *  and can never escalate its room, so the test the cap answers does not
   *  apply to it (see EntityVisuals.FOCUS_MAX_CHIPS). */
  max = MAX_TOTAL_CHIPS,
  /**
   * The widest this arrangement may be, in the same units as `unit`. Given
   * one, the cards WRAP to fit it instead of running off the side — which is
   * what lets a focused group show every device on a narrow screen at a large
   * icon size. Omitted (the ordinary path) the shape is unchanged.
   */
  maxWidth = 0,
  /** Cells per CARD. `PHONE_MAX_GRID_CHIPS` on a phone, so a pile draws pairs
   *  side by side instead of one 2x2 — see that constant. LAST on purpose:
   *  every existing caller passes positionally, and slotting a parameter in
   *  ahead of `maxWidth` would have silently handed the width budget to this. */
  perCard = MAX_GRID_CHIPS,
): CardArrangement {
  const cells = gridCells(n, max);
  const chip = Math.max(4, Math.round(unit * iconFraction));
  const cards: SubCard[] = [];

  // Greedy fill: a full card, then whatever is left.
  let remaining = Math.max(1, cells);
  let first = 0;
  const shapes: { cols: number; rows: number; cells: number; first: number }[] = [];
  while (remaining > 0) {
    const take = Math.min(remaining, Math.max(1, perCard));
    const cols = take <= 2 ? Math.max(1, take) : 2;
    shapes.push({ cols, rows: Math.max(1, Math.ceil(take / cols)), cells: take, first });
    first += take;
    remaining -= take;
  }

  // ── Cards WRAP once there are more than two of them ──────────────────────
  // Up to MAX_TOTAL_CHIPS a fill produces at most two cards, so this is a
  // single row and every arrangement the ordinary solve can ask for is
  // byte-identical to what shipped before. Above it — only reachable by a
  // focused group — a single row would become a strip several screens wide,
  // and the viewport cap would then refuse it and fall back to a count, which
  // is the one outcome a tapped room must never produce. A near-square block
  // keeps the same card objects and just stacks them.
  // ── How many cards per row ───────────────────────────────────────────────
  // With a width budget, as many as fit — that is what makes the arrangement
  // ADAPT rather than refuse. Without one, a near-square block. Never zero: a
  // single card that does not fit is still drawn, because a device the user
  // asked to see must be on screen even if it is tight.
  const widest = Math.max(...shapes.map((sh) => sh.cols * unit));
  const perRow = Math.min(shapes.length, Math.max(1, maxWidth > 0
    ? Math.floor((maxWidth + gap) / (widest + gap))
    : Math.ceil(Math.sqrt(shapes.length))));
  const rows: typeof shapes[] = [];
  for (let i = 0; i < shapes.length; i += perRow) rows.push(shapes.slice(i, i + perRow));

  const rowW = rows.map((r) => r.reduce((acc, sh) => acc + sh.cols * unit, 0) + gap * (r.length - 1));
  const rowH = rows.map((r) => Math.max(...r.map((sh) => sh.rows * unit)));
  const totalW = Math.max(...rowW);
  const height = rowH.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);

  let rowTop = -height / 2;
  rows.forEach((row, ri) => {
    let cursor = -rowW[ri] / 2;
    for (const sh of row) {
      const w = sh.cols * unit;
      cards.push({
        left: cursor + w / 2,
        top: rowTop + rowH[ri] / 2,
        width: w,
        height: sh.rows * unit,
        cols: sh.cols,
        rows: sh.rows,
        first: sh.first,
        cells: sh.cells,
      });
      cursor += w + gap;
    }
    rowTop += rowH[ri] + gap;
  });

  const cardOfCell = (k: number): SubCard => {
    for (let i = cards.length - 1; i >= 0; i--) if (k >= cards[i].first) return cards[i];
    return cards[0];
  };

  return {
    cards,
    width: totalW,
    height,
    chip,
    pitch: unit,
    cells,
    cellLeft: (k) => {
      const c = cardOfCell(k);
      const i = k - c.first;
      return c.left + ((i % c.cols) - (c.cols - 1) / 2) * unit;
    },
    cellTop: (k) => {
      const c = cardOfCell(k);
      const i = k - c.first;
      return c.top + (Math.floor(i / c.cols) - (c.rows - 1) / 2) * unit;
    },
    zoneW: unit,
    zoneH: unit,
  };
}
