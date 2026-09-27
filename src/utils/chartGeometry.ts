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

import { lineRuns, timeScale, type TimeWindow } from "./lineChart";
import { gapBand } from "./historyGaps";
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
  /** Per series: the outage under the pointer — its DRAWN band, which is
   *  never narrower than MIN_BAND_OF_PLOT — or null. Where one is, that
   *  series has no reading: what is drawn as unavailable reads as it. */
  outages: (HistoryGap | null)[];
}

/**
 * The narrowest an outage band is drawn, as a fraction of the plot's width.
 *
 * ⚠️ AN OUTAGE WAS DRAWN AS WIDE AS IT LASTED (2.496.149). On a 24-hour chart
 * 320 units wide a unit is 4.5 minutes, so the pool pump's three 3-minute
 * drop-outs were hairlines and its 1–3 second blips nothing at all — while the
 * line was still broken at each one (owner: "why do I see line cuts … I expect
 * an unavailable background"). And a pointer step covers the same 4.5 minutes,
 * so hovering the hairline landed beside it: the tooltip showed the reading
 * after the outage, never the outage. Every band is now at least this wide,
 * centred on its outage, and the hover reads the band as drawn.
 */
export const MIN_BAND_OF_PLOT = 1 / 120;

export interface SeriesGeometry {
  lo: number;
  hi: number;
  sy: (v: number) => number;
  /** The y-axis: round values (niceTicks) inside [lo, hi], each at its pixel
   *  y. ONE tick rule for every line chart (2.496.115) — the sparklines drew
   *  hi/mid/lo, the dual one hi/lo, the Weather charts these. */
  ticks: { v: number; y: number }[];
  /** The line in pixels: stepped, held, split at this series' outages. */
  runs: { x: number; y: number }[][];
  /** This series' outages, each in the series' own horizontal slice of the
   *  plot (one series: the full height; two: a half each), never narrower than
   *  MIN_BAND_OF_PLOT, with the outage it draws. */
  bands: { x: number; w: number; y: number; h: number; gap: HistoryGap }[];
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

/** Runs with every stretch inside a band removed: each run is cut at the
 *  band's edges, the cut point on the run's own segment. */
export function clipRuns(
  runs: readonly { x: number; y: number }[][], bands: readonly { x: number; w: number }[],
): { x: number; y: number }[][] {
  const inside = (x: number) => bands.some((b) => x > b.x && x < b.x + b.w);
  const out: { x: number; y: number }[][] = [];
  for (const run of runs) {
    let cur: { x: number; y: number }[] = [];
    const flush = () => { if (cur.length >= 2) out.push(cur); cur = []; };
    for (let k = 0; k < run.length; k++) {
      const p = run[k];
      if (k > 0) {
        const a = run[k - 1];
        // Every band edge crossed on this segment, in order along it.
        const edges = bands.flatMap((b) => [b.x, b.x + b.w])
          .filter((e) => (e > Math.min(a.x, p.x) && e < Math.max(a.x, p.x)))
          .sort((e1, e2) => (p.x >= a.x ? e1 - e2 : e2 - e1));
        for (const e of edges) {
          const f = (e - a.x) / (p.x - a.x);
          const q = { x: e, y: a.y + f * (p.y - a.y) };
          if (inside((q.x + (p.x >= a.x ? -1e-6 : 1e-6)))) { flush(); cur.push(q); }   // leaving a band
          else { cur.push(q); flush(); }                                              // entering one
        }
      }
      if (!inside(p.x)) cur.push(p);
    }
    flush();
  }
  return out;
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
    const minW = (plot.right - plot.left) * MIN_BAND_OF_PLOT;
    const bands = s.gaps.flatMap((gap) => {
      if (!gapBand(gap, sx, plot.left, plot.right)) return [];   // outside the plot
      const clamp = (v: number) => Math.max(plot.left, Math.min(plot.right, v));
      const x0 = clamp(sx(gap.from)), x1 = clamp(sx(gap.to));
      const w = Math.max(x1 - x0, minW);
      const x = Math.max(plot.left, Math.min(plot.right - w, (x0 + x1) / 2 - w / 2));
      return [{ x, w, y: plot.top + i * slice, h: Math.max(1, slice), gap }];
    });
    // ⚠️ THE LINE IS CUT WHERE THE BAND IS DRAWN, not only where the outage
    // was (2.496.150). A band widened to be seen, with the line running
    // through it, says "unavailable" and draws a value at once — on the pool
    // pump's chart every band had the line straight across it (owner: "this
    // is not what we see in the picture"). The hover already reads the drawn
    // band as the outage; the line now agrees.
    const runs = clipRuns(
      lineRuns(s.pts, s.gaps, window).filter((r) => r.length >= 2).map((r) => r.map((p) => ({ x: sx(p.t), y: sy(p.v) }))),
      bands,
    );
    // About four steps: a line keeps its own range (a bar chart rounds its
    // top up instead), so only the ticks INSIDE it are drawn — three steps
    // left a 0–900 W/m² line with two labels.
    const ticks = niceTicks(lo, hi, 4).ticks
      .filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9)
      .map((v) => ({ v, y: sy(v) }));
    return { lo, hi, sy, ticks, runs, bands };
  });
  const hover = (t: number): ChartHover | null => {
    const px = sx(t);
    const outages = series.map((sg) => sg.bands.find((b) => px >= b.x && px <= b.x + b.w)?.gap ?? null);
    const readings = input.map((s, i) => {
      if (outages[i]) return null;
      const r = readingAt(s.pts, s.gaps, t);
      return r ? { t: r.t, v: r.v, x: sx(r.t), y: series[i].sy(r.v) } : null;
    });
    const shown = readings.filter((r): r is HoverReading => r !== null);
    // Over nothing but an outage: the crosshair stays at the pointer and the
    // tooltip says so (it returned null here — no tooltip at all).
    if (shown.length === 0) return outages.some(Boolean) ? { t, x: px, readings, outages } : null;
    const at = Math.max(...shown.map((r) => r.t));
    return { t: at, x: sx(at), readings, outages };
  };
  return {
    window, spanHours: span / 3_600_000, sx, tAt, series,
    ticks: [window.from, (window.from + window.to) / 2, window.to],
    hover,
  };
}

/**
 * Round y-axis ticks over [lo, hi]: a 1-2-2.5-5 step ×10ⁿ giving about `n`
 * intervals, ticks on its multiples. `top`/`bottom` are the rounded ends a
 * bar chart scales to; a line chart keeps its own range and shows only the
 * ticks inside it (owner, 2026-09-26: "always show the Y-axis, so the value
 * the chart shows can be read").
 */
export function niceTicks(lo: number, hi: number, n = 3): { ticks: number[]; bottom: number; top: number; step: number } {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, n);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.999) ?? 10 * mag;
  const bottom = Math.floor(lo / step + 1e-9) * step;
  const top = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, bottom, top, step };
}

/** An axis label: no trailing zeros, thousands as k and millions as M. */
export function fmtAxis(v: number, step?: number): string {
  const a = Math.abs(v);
  const trim = (x: number, d: number) => String(Number(x.toFixed(d)));
  // ⚠️ WITH THE AXIS' STEP, EXACTLY (2.496.144): a 2.5 step labelled
  // 27.5 / 25 / 22.5 / 20 as "28, 25, 23, 20" — the ≥ 10 rule's whole
  // numbers rounded half the ticks. As many decimals as the step needs, in
  // the same k / M the value takes.
  if (step !== undefined && step > 0) {
    const div = a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1;
    const s = step / div;
    let d = 0;
    while (d < 3 && Math.abs(s * 10 ** d - Math.round(s * 10 ** d)) > 1e-9) d++;
    return `${trim(v / div, d)}${div === 1e6 ? "M" : div === 1e3 ? "k" : ""}`;
  }
  if (a >= 1e6) return `${trim(v / 1e6, 1)}M`;
  if (a >= 1e4) return `${trim(v / 1e3, 0)}k`;
  if (a >= 1e3) return `${trim(v / 1e3, 1)}k`;
  if (a >= 10 || Number.isInteger(v)) return trim(v, 0);
  return trim(v, a >= 1 ? 1 : 2);
}
