// src/utils/chartGeometry.ts
// Everything a history chart draws, between the series and the pixels — for
// every chart in the app: the device panels' Sparkline and DualSparkline, and
// the Weather window's line and rain charts. They only render what this says.
//
// ⚠️ IT WAS WRITTEN THREE TIMES, AND THE COPIES HAD DRIFTED (2.496.88):
//   * three hover rules — nearest reading by pixel, a "rail" on the denser of
//     two series, nearest by time — none of which knew about outages, so
//     hovering inside one line's outage showed its last value from BEFORE the
//     outage, stamped with the other line's time;
//   * two outage-band policies — the device panels shaded each series in its
//     own band, the Weather charts shaded only the FIRST line's outages, so an
//     indoor sensor that went down broke its line with nothing to say why;
//   * two x-scales and two tick labellers.
// One module now owns the scales, the lines (lineChart.lineRuns), a band per
// series, the ticks and the hover answer. Pure; tests/oracles/chart_geometry.mjs
// drives it.

import { lineRuns, outageBands, timeScale, type TimeWindow } from "./lineChart";
import type { Reading } from "./stepSeries";
import type { HistoryGap } from "@/types/ha.types";

export interface PlotRect { left: number; right: number; top: number; bottom: number }

export interface ChartSeriesInput {
  /** The real readings, in time order — what hover reports. */
  pts: readonly Reading[];
  /** Where this series reported nothing (HistorySeries.gaps). */
  gaps: readonly HistoryGap[];
  /** "shared": one y-scale with every other shared series (the default);
   *  "own": its own min–max (a second axis); "fromZero": its own 0–max. */
  scale?: "shared" | "own" | "fromZero";
}

export interface HoverReading { t: number; v: number; x: number; y: number }

export interface ChartHover {
  /** Where the crosshair goes, and the one stamp that describes every row:
   *  the latest of the readings shown, each of which holds at that moment. */
  t: number;
  x: number;
  /** Per series, in input order: the reading in force, or null where that
   *  series has none — before its first reading, or inside its outage. */
  readings: (HoverReading | null)[];
}

export interface SeriesGeometry {
  lo: number;
  hi: number;
  sy: (v: number) => number;
  /** The line in pixels: stepped, held, split at this series' outages. */
  runs: { x: number; y: number }[][];
  /** This series' outages, each in the series' own horizontal slice of the
   *  plot (one series: the full height; two: a half each). */
  bands: { x: number; w: number; y: number; h: number }[];
}

export interface ChartGeometry {
  window: TimeWindow;
  spanHours: number;
  sx: (t: number) => number;
  /** Pixel x → time in the window (clamped). */
  tAt: (x: number) => number;
  series: SeriesGeometry[];
  /** Start, middle and end of the window. */
  ticks: number[];
  hover: (t: number) => ChartHover | null;
}

/** The reading in force at `t`: the last one at or before it, unless `t` is
 *  inside one of the series' outages (a reading holds until it changes — see
 *  stepSeries — but not across a stretch nobody reported). */
export function readingAt(pts: readonly Reading[], gaps: readonly HistoryGap[], t: number): Reading | null {
  if (gaps.some((g) => t >= g.from && t < g.to)) return null;
  let lo = 0, hi = pts.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best < 0 ? null : pts[best];
}

/**
 * The geometry of one chart. `pad` widens the shared and own scales by that
 * fraction of their span (0 = the data touches the plot's edges); a flat
 * series gets a span of 1 above its value so it is drawn, not divided by zero.
 */
export function chartGeometry(
  window: TimeWindow, input: readonly ChartSeriesInput[], plot: PlotRect, pad = 0,
): ChartGeometry {
  const sx = timeScale(window, plot.left, plot.right);
  const span = window.to - window.from || 1;
  const tAt = (x: number) =>
    window.from + Math.max(0, Math.min(1, (x - plot.left) / ((plot.right - plot.left) || 1))) * span;
  const range = (vs: number[], fromZero: boolean): [number, number] => {
    if (vs.length === 0) return [0, 1];
    let lo = fromZero ? 0 : Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo <= 0) hi = lo + 1;
    if (!fromZero && pad > 0) { const p = (hi - lo) * pad; lo -= p; hi += p; }
    return [lo, hi];
  };
  const shared = range(input.filter((s) => (s.scale ?? "shared") === "shared").flatMap((s) => s.pts.map((p) => p.v)), false);
  const slice = (plot.bottom - plot.top) / Math.max(1, input.length);
  const series = input.map((s, i): SeriesGeometry => {
    const kind = s.scale ?? "shared";
    const [lo, hi] = kind === "shared" ? shared : range(s.pts.map((p) => p.v), kind === "fromZero");
    const sy = (v: number) => plot.bottom - ((v - lo) / (hi - lo)) * (plot.bottom - plot.top);
    const runs = lineRuns(s.pts, s.gaps, window)
      .filter((r) => r.length >= 2)
      .map((r) => r.map((p) => ({ x: sx(p.t), y: sy(p.v) })));
    const bands = outageBands(s.gaps, sx, plot.left, plot.right)
      .map((b) => ({ ...b, y: plot.top + i * slice, h: Math.max(1, slice) }));
    return { lo, hi, sy, runs, bands };
  });
  const hover = (t: number): ChartHover | null => {
    const readings = input.map((s, i) => {
      const r = readingAt(s.pts, s.gaps, t);
      return r ? { t: r.t, v: r.v, x: sx(r.t), y: series[i].sy(r.v) } : null;
    });
    const shown = readings.filter((r): r is HoverReading => r !== null);
    if (shown.length === 0) return null;
    const at = Math.max(...shown.map((r) => r.t));
    return { t: at, x: sx(at), readings };
  };
  return {
    window, spanHours: span / 3_600_000, sx, tAt, series,
    ticks: [window.from, (window.from + window.to) / 2, window.to],
    hover,
  };
}
