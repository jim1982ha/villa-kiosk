// src/utils/historyGaps.ts
// Where a numeric series had NO USABLE READING, and how a line chart is split
// around those stretches.
//
// THE DEFECT THIS EXISTS FOR
// `fetchHistory` parsed every row with `numericState` and then dropped whatever
// did not come out finite:
//
//     .map((s) => ({ t, v: numericState(s.state) }))
//     .filter((p) => Number.isFinite(p.v))
//
// "unavailable" and "unknown" parse to NaN, so an outage was not drawn as an
// outage — it was DELETED, and the sparkline joined the last reading before it
// straight to the first reading after it. On a pump that had been off since
// 22:15 and offline overnight, that drew a smooth diagonal climbing all night:
// a picture of a device slowly ramping up, for hours in which it reported
// nothing at all. Reported from the villa against 2.496.48.
//
// ⚠️ THE STATE TIMELINE NEXT DOOR NEVER HAD THIS PROBLEM, and that is the whole
// reason the two disagreed on screen. It reads RAW state strings through
// `statusKeyFor`, so "unavailable" is a value it can colour; the numeric path
// turns everything into a number first, and a number has no way to say "there
// was nothing here". The fix is to carry that fact alongside the numbers rather
// than to make some sentinel number mean it — which is the same mistake as
// `Number(null) === 0`, one level up.
//
// PURE ON PURPOSE — imports nothing, so an oracle runs the real functions under
// plain `node`.

import type { HistoryGap } from "@/types/ha.types";

/**
 * The stretches of time a series reported nothing usable.
 *
 * Takes rows that have ALREADY been parsed, finite or not, in ascending time
 * order — so the caller keeps one definition of "is this a reading" (`numericState`)
 * and this module never re-parses a state string.
 *
 * A gap opens at the timestamp of the first unusable row and closes at the
 * timestamp of the next usable one, which is exactly the span in which the
 * chart has nothing to draw.
 *
 * ⚠️ A TRAILING GAP CLOSES AT `now`, NOT AT THE LAST ROW. If the entity is
 * unavailable right now, the outage has not ended, and closing it at the last
 * row would draw a band that stops short of the present and imply the device
 * came back. The chart clamps the band to its own plot area, so passing a `now`
 * beyond the last plotted point is safe and is the honest input.
 */
export function gapsFrom(rows: readonly { t: number; v: number }[], now: number): HistoryGap[] {
  const gaps: HistoryGap[] = [];
  let open: number | null = null;
  for (const r of rows) {
    if (Number.isFinite(r.v)) {
      if (open !== null) { gaps.push({ from: open, to: r.t }); open = null; }
    } else if (open === null) {
      open = r.t;
    }
  }
  if (open !== null) gaps.push({ from: open, to: Math.max(open, now) });
  return gaps;
}

/**
 * Split plotted points into runs that do not span a gap, so a line chart draws
 * one polyline per run instead of one line through the outage.
 *
 * ⚠️ THE BAND ALONE WOULD NOT BE ENOUGH, and shipping only the band would be
 * worse than shipping neither. A shaded "nothing was reported here" panel with
 * an unbroken line climbing through it states both things at once and lets the
 * reader believe the line. The break is what makes the band true.
 *
 * A gap sits BETWEEN two consecutive points, so the test is whether the
 * interval (a.t, b.t] contains a gap's start — not whether either endpoint is
 * inside one, which no plotted point ever is (they are all finite readings).
 */
export function splitAtGaps<T extends { t: number }>(
  pts: readonly T[],
  gaps: readonly HistoryGap[],
): T[][] {
  if (!gaps.length || pts.length < 2) return pts.length ? [pts.slice()] : [];
  const runs: T[][] = [];
  let run: T[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const broken = gaps.some((g) => g.from >= a.t && g.from < b.t);
    if (broken) { runs.push(run); run = [b]; } else { run.push(b); }
  }
  runs.push(run);
  return runs;
}

/**
 * A gap's band in plot pixels, clamped to the plot, or null when it does not
 * intersect it at all.
 *
 * ⚠️ MINIMUM ONE PIXEL. A sensor that dropped out for thirty seconds inside a
 * 7-day window is a sub-pixel band, and rounding it away would report "no
 * outage" — the very claim this whole change exists to stop the chart making.
 * One pixel is the smallest honest answer.
 */
export function gapBand(
  g: HistoryGap,
  sx: (t: number) => number,
  left: number,
  right: number,
): { x: number; w: number } | null {
  if (g.to <= g.from && !Number.isFinite(g.to)) return null;
  const x0 = Math.max(left, Math.min(right, sx(g.from)));
  const x1 = Math.max(left, Math.min(right, sx(g.to)));
  if (x1 <= left || x0 >= right) return null;
  return { x: x0, w: Math.max(1, x1 - x0) };
}
