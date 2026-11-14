// src/babylon/chipPlace.ts
// Where a room chip may be DRAWN: inside the part of the map a person can see
// (the canvas minus the bars and the rail the HUD lays over it), off every
// drawn badge and card, and in as many columns as its lines need to fit.
//
// ── WHY (2.496.803) ─────────────────────────────────────────────────────────
// Owner's screenshots: in a tilted overview an eleven-line merged chip ran off
// the top of the screen under the top bar, a one-room chip sat cut off
// in the top-left corner under the floor rail, a chip at the left edge was half
// off the map, and a merged chip stood over the corner of a group card. A chip
// rendered at its anchor wherever that anchor projected, and nothing it was
// tested against knew where the screen, the HUD or the cards ended.
//
// ⚠️ A CHIP STILL NEVER LEAVES ITS ROOM FOR SPACE (placementPass.deriveChips,
// 2.120.0): it moves only as far as staying visible and off a badge or a card
// demands, never to clear another chip (two chips that touch still merge), and
// never more than one chip's size from where it stands (CHIP_REACH).
//
// Pure: every answer is a function of one box, the area and the obstacles, so
// the merge fixpoint that calls it stays a fixpoint. tests/oracles/room_chips.mjs.

/** A rectangle on the canvas, render px, y down. */
export interface ScreenRect { left: number; top: number; right: number; bottom: number }

/** A box by centre and half extents, render px, y down. */
export interface PlaceBox { cx: number; cy: number; hw: number; hh: number }

/** The visible map: the bounds a chip is kept inside, and what the HUD lays
 *  over it inside those bounds (the left rail) as boxes to keep off. */
export interface MapArea extends ScreenRect { blocks: PlaceBox[] }

/**
 * The visible map, from the viewport and the HUD's rectangles over it.
 *
 * A rectangle across at least half the width that touches the top or bottom
 * edge is a BAR (the top bar, the bottom bar): it moves that edge in, so a
 * chip's column height is what is left between them. Any other one (the floor
 * and presence rail) is a block: a chip keeps off it like off a card, without
 * giving up the strip of map beside it. Everything is inset by `gap`, the
 * clear space every other tier keeps.
 */
export function mapArea(
  vp: { x: number; y: number; width: number; height: number },
  cover: readonly ScreenRect[], gap: number,
): MapArea {
  let top = vp.y, bottom = vp.y + vp.height;
  const left = vp.x, right = vp.x + vp.width;
  const blocks: PlaceBox[] = [];
  for (const r of cover) {
    if (!(r.right > left && r.left < right && r.bottom > top && r.top < bottom)) continue;
    const wide = r.right - r.left >= vp.width / 2;
    if (wide && r.top <= vp.y + 1) top = Math.max(top, r.bottom);
    else if (wide && r.bottom >= vp.y + vp.height - 1) bottom = Math.min(bottom, r.top);
    else blocks.push({ cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, hw: (r.right - r.left) / 2, hh: (r.bottom - r.top) / 2 });
  }
  // Bars that leave no map (a window shorter than its own HUD): the viewport.
  if (bottom - top < 2 * gap) { top = vp.y; bottom = vp.y + vp.height; }
  return { left: left + gap, top: top + gap, right: right - gap, bottom: bottom - gap, blocks };
}

/**
 * A chip of `lines` lines, `unitPx` each, in a map `heightPx` tall: one column
 * while it fits, else as few columns as fit, each filling top-down and the
 * lines shared out evenly (11 lines where 6 fit: 2 columns of 6 and 5).
 */
export function chipGrid(lines: number, unitPx: number, heightPx: number): { cols: number; rows: number } {
  const n = Math.max(1, lines);
  const fit = unitPx > 0 && heightPx > 0 ? Math.max(1, Math.floor(heightPx / unitPx)) : n;
  const cols = Math.ceil(n / fit);
  return { cols, rows: Math.ceil(n / cols) };
}

/** How far a chip may be moved off a badge or a card, in chip sizes (its own
 *  width plus height): far enough to step past a group card beside it, not so
 *  far that it reads as another room's label. */
const CHIP_REACH = 2;
/** Spare px on a moved chip's edge, so a box placed exactly one gap away is not
 *  read as touching through rounding. */
const PLACE_SLACK = 0.5;

/** `box` moved inside `a`; centred on an axis it is too big for. */
function clampInto(a: ScreenRect, cx: number, cy: number, hw: number, hh: number): { cx: number; cy: number } {
  return {
    cx: a.right - a.left < 2 * hw ? (a.left + a.right) / 2 : Math.min(Math.max(cx, a.left + hw), a.right - hw),
    cy: a.bottom - a.top < 2 * hh ? (a.top + a.bottom) / 2 : Math.min(Math.max(cy, a.top + hh), a.bottom - hh),
  };
}

/**
 * Where a chip whose drawn box is `box` is drawn: inside the visible map, and
 * off every obstacle (drawn badges, cards, the HUD's blocks) by one gap.
 *
 * First the box is moved inside the map, which every chip needs. If that spot
 * is clear it is the answer. Otherwise the nearest clear spot is taken among
 * those touching an obstacle from above, below, left or right (and, once more,
 * beside whatever that spot lands on), each kept inside the map, within
 * CHIP_REACH; ties go top-most, then left-most, so the answer does not depend
 * on the order obstacles arrive in. No clear spot within reach: the clamped one,
 * `clear` false (placementCheck counts what is left). `reachSizes` widens the
 * reach for an opened chip (placementPass's `spread`).
 */
export function placeChip(
  box: PlaceBox, area: MapArea, obstacles: readonly PlaceBox[], gap: number, reachSizes = CHIP_REACH,
): { cx: number; cy: number; clear: boolean } {
  const { hw, hh } = box;
  const all = area.blocks.length ? [...area.blocks, ...obstacles] : obstacles;
  const start = clampInto(area, box.cx, box.cy, hw, hh);
  const hitAt = (cx: number, cy: number): PlaceBox | null => {
    for (const o of all) {
      if (Math.abs(cx - o.cx) < hw + o.hw + gap && Math.abs(cy - o.cy) < hh + o.hh + gap) return o;
    }
    return null;
  };
  if (!hitAt(start.cx, start.cy)) return { ...start, clear: true };
  const reach = reachSizes * (2 * hw + 2 * hh);
  const beside = (o: PlaceBox, from: { cx: number; cy: number }) => {
    const dx = hw + o.hw + gap + PLACE_SLACK, dy = hh + o.hh + gap + PLACE_SLACK;
    return [
      clampInto(area, from.cx, o.cy - dy, hw, hh), clampInto(area, from.cx, o.cy + dy, hw, hh),
      clampInto(area, o.cx - dx, from.cy, hw, hh), clampInto(area, o.cx + dx, from.cy, hw, hh),
    ];
  };
  const near = all.filter((o) => Math.abs(o.cx - start.cx) < reach + hw + o.hw && Math.abs(o.cy - start.cy) < reach + hh + o.hh);
  const tried: { cx: number; cy: number }[] = [];
  for (const o of near) {
    for (const c of beside(o, start)) {
      tried.push(c);
      const next = hitAt(c.cx, c.cy);
      if (next) tried.push(...beside(next, c));
    }
  }
  let best: { cx: number; cy: number } | null = null, bestD = Infinity;
  for (const c of tried) {
    const d = (c.cx - start.cx) ** 2 + (c.cy - start.cy) ** 2;
    if (d > reach * reach || d > bestD || hitAt(c.cx, c.cy)) continue;
    if (d < bestD || !best || c.cy < best.cy || (c.cy === best.cy && c.cx < best.cx)) { best = c; bestD = d; }
  }
  return best ? { ...best, clear: true } : { ...start, clear: false };
}
