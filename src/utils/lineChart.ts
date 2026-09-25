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
