// src/utils/lineChart.ts
// What a line chart of Home Assistant history draws, against the window it
// was ASKED to show — not the span of whatever readings happened to come back.
//
// ⚠️ "WHICH SPAN DOES THIS CHART SHOW?" HAD FOUR ANSWERS. The fetch knew the
// window and did not return it; both line charts scaled their x-axis to their
// own first and last FINITE readings; the state timeline recomputed
// now-minus-hours. So a sensor that was offline RIGHT NOW drew no outage band
// at all: the outage starts after the last finite reading, the x-axis ends at
// that reading, and gapBand clamped it past the right edge and returned null —
// the one case two comments called safe (reproduced, 2026-09-25). The last
// held value stopped there too, although a reading holds until it changes.
//
// Now the window travels with the series (HistorySeries.window) and this
// module owns every rule between it and the pixels: the scale, the step, the
// hold to the window's end, the split at outages, and the band. Pure;
// tests/oracles/line_chart.mjs drives it with the cases that were broken.

import { stepped, type Reading } from "./stepSeries";
import { splitAtGaps, gapBand } from "./historyGaps";
import type { HistoryGap, StateHistoryPoint } from "@/types/ha.types";

export interface TimeWindow { from: number; to: number }

/** The window to draw: the one asked for, or — for a caller that has none —
 *  the extent of the data, which is what every chart did before. */
export function chartWindow(window: TimeWindow | undefined, ...series: readonly (readonly Reading[])[]): TimeWindow | null {
  if (window && window.to > window.from) return window;
  const ts = series.flat().map((d) => d.t);
  if (ts.length < 2) return null;
  return { from: Math.min(...ts), to: Math.max(...ts) };
}

/**
 * The window a line chart can draw, or null for "Not enough history": there
 * must be a reading, and a window — the one asked for, or two readings' span.
 * ONE reading over a known window IS a line: a gauge that held one value all
 * day (0 mm since midnight) comes back as a single row and holds to the end.
 * (The device panels' two charts had this rule two ways, round 9.)
 */
export function drawableWindow(window: TimeWindow | undefined, ...series: readonly (readonly Reading[])[]): TimeWindow | null {
  return series.some((s) => s.length > 0) ? chartWindow(window, ...series) : null;
}

/** Time → x across [left, right]. */
export function timeScale(w: TimeWindow, left: number, right: number): (t: number) => number {
  const span = w.to - w.from || 1;
  return (t: number) => left + ((t - w.from) / span) * (right - left);
}

/**
 * The line to draw, in data space: stepped (a reading HOLDS until it changes —
 * see stepSeries), held to the end of the window, then split into runs that
 * never cross an outage.
 *
 * The hold stops where knowledge stops: at the window's end, or at the start
 * of an outage that began after the last reading, whichever is first. A
 * sensor that went offline at 20:00 holds its 19:00 value until 20:00 and not
 * a moment past it — the band says the rest.
 *
 * ⚠️ FOR THE LINE ONLY. The points this adds are not readings; a chart keeps
 * its real points for hover and statistics.
 */
export function lineRuns(data: readonly Reading[], gaps: readonly HistoryGap[], w: TimeWindow): Reading[][] {
  if (data.length === 0) return [];
  const line = stepped(data);
  const last = data[data.length - 1];
  let holdUntil = w.to;
  for (const g of gaps) if (g.from >= last.t) holdUntil = Math.min(holdUntil, g.from);
  if (holdUntil > last.t) line.push({ t: holdUntil, v: last.v });
  // ⚠️ THE SAME HOLD BEFORE EVERY OUTAGE, NOT ONLY AFTER THE LAST READING
  // (2.496.149). splitAtGaps ends a run at the last POINT before an outage, so
  // a value held steady up to it was cut back to its reading: the pool pump,
  // at 0 W for an hour before a two-second blip, lost that whole hour — a gap
  // in the line with no band anywhere near it ("line cuts" with nothing
  // unavailable, owner, 2026-09-27). Each outage now gets a point at its start
  // carrying the value in force.
  const holds: Reading[] = [];
  for (const g of gaps) {
    if (g.from <= data[0].t || g.from >= last.t) continue;   // before the first reading, or handled above
    let lo = 0, hi = data.length - 1, at = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (data[mid].t <= g.from) { at = mid; lo = mid + 1; } else hi = mid - 1; }
    if (at >= 0 && data[at].t < g.from) holds.push({ t: g.from, v: data[at].v });
  }
  if (holds.length) {
    line.push(...holds);
    // Stable by time; a hold sorts BEFORE a point at the same instant.
    line.sort((p, q) => p.t - q.t);
  }
  return splitAtGaps(line, gaps);
}

/** One shaded band per outage, in pixels, clamped to the plot. Measured
 *  against the WINDOW's scale, so an outage running to now reaches the right
 *  edge instead of falling off it. */
export function outageBands(
  gaps: readonly HistoryGap[], sx: (t: number) => number, left: number, right: number,
): { x: number; w: number }[] {
  return gaps
    .map((g) => gapBand(g, sx, left, right))
    .filter((b): b is { x: number; w: number } => b !== null);
}

/** The points of `deep` that describe the `hours` ending at `end`: every
 *  change inside it, plus the last one BEFORE it — the state the window opens
 *  in. */
export function windowEndingAt(deep: readonly StateHistoryPoint[], end: number, hours: number): StateHistoryPoint[] {
  const from = end - hours * 3600 * 1000;
  let anchor = -1;
  for (let i = 0; i < deep.length && deep[i].t < from; i++) anchor = i;
  return deep.filter((pt, i) => i === anchor || (pt.t >= from && pt.t <= end));
}

/**
 * The outages in a series of STATISTICS buckets (5-minute or hourly means):
 * a bucket the recorder did not write is a stretch with no reading. A line
 * through it would draw a measurement that was never taken — the rule every
 * line chart here keeps (tests/oracles/history_gaps.mjs), for a series whose
 * gaps are not in the rows but between them.
 *
 * A gap is more than 1.5 buckets between two bucket starts, a window that
 * opens more than 1.5 buckets before the first, or more than THREE buckets
 * after the last one's end: the recorder writes a bucket only once it has
 * closed, so the newest is legitimately a bucket or two behind now.
 */
export function bucketGaps(pts: readonly Reading[], periodMs: number, w: TimeWindow): HistoryGap[] {
  if (pts.length === 0 || !(periodMs > 0)) return [];
  const gaps: HistoryGap[] = [];
  if (pts[0].t - w.from > periodMs * 1.5) gaps.push({ from: w.from, to: pts[0].t });
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > periodMs * 1.5) gaps.push({ from: pts[i - 1].t + periodMs, to: pts[i].t });
  }
  const lastEnd = pts[pts.length - 1].t + periodMs;
  if (w.to - lastEnd > periodMs * 3) gaps.push({ from: lastEnd, to: w.to });
  return gaps;
}
