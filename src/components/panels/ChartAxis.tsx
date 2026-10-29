// src/components/panels/ChartAxis.tsx
// The y-axis every history chart in the Weather and Energy windows draws
// (owner, 2026-09-26: "always show the Y-axis details, so the user knows the
// value displayed"). Labels are placed by fraction of the plot's height, so
// the same axis stands beside an SVG plot and a column of HTML bars; the
// ticks themselves are chartGeometry's (a line chart's series.ticks) or
// barChart's (barLayout.ticks) — one rule, niceTicks, and one label, fmtAxis.

import { useSyncExternalStore, type ReactNode } from "react";
import { ArrowDownToLine, FoldVertical } from "lucide-react";
import { fmtAxis } from "@/utils/chartGeometry";
import { chartFit, onChartFit, toggleChartFit, type ChartFit } from "@/utils/viewPrefs";

/** The tablet's axis fit (viewPrefs), live: every chart shown re-draws when one axis is tapped. */
export function useChartFit(): ChartFit {
  return useSyncExternalStore(onChartFit, chartFit, chartFit);
}

/** The axis fit, seen and tapped (owner, 2026-10-26): at the bottom of a line chart's axis, in the empty corner of
 *  its dates' row (LineChart.TimeAxis), "from 0" an arrow down to a baseline with a 0, "fitted" two arrows closing in
 *  on a line. A tap swaps the fit as a tap on the axis numbers does: the one setting, every line chart on this tablet.
 *  A bar chart has none (always from 0). */
export function FitMark() {
  const fit = useChartFit();
  const words = fit === "zero" ? "Axis from 0: tap to fit" : "Axis fitted: tap to show from 0";
  return (
    <button type="button" className={`chart-fit-mark ${fit}`} aria-label={words} title={words} onClick={toggleChartFit}>
      {fit === "zero" ? <><ArrowDownToLine size={15} aria-hidden /><span className="chart-fit-zero" aria-hidden>0</span></>
        : <FoldVertical size={15} aria-hidden />}
    </button>
  );
}

/** A unit on the line above a line chart, in its line's colour (its class, or its CSS colour). */
export interface UnitCap { unit?: string; cls?: string; color?: string }

const capClass = (c: UnitCap, side: string) => `chart-unit ${side}${c.cls ? ` tint-${c.cls}` : ""}`;

/** The line above every line chart (owner, 2026-10-26), one height filtered or not, in the chart's own columns: the
 *  left unit over the axis numbers (past the slider's column when there is one), a range's chip (`children`) at the
 *  right, under the period buttons, and a right axis' unit over it. The axes draw no unit then. */
export function ChartUnitLine({ left, right, slider, action, children }: {
  left: UnitCap; right?: UnitCap | null; slider?: boolean;
  /** At the far right of the line (a chart's "enlarge", owner 2026-10-29). */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const style = (c: UnitCap) => (c.color ? { color: c.color } : undefined);
  return (
    <div className="chart-unit-line">
      {slider && <span className="chart-unit-slider" />}
      <span className={capClass(left, "left")} style={style(left)}>{left.unit}</span>
      <span className="chart-unit-grow" />
      {children}
      {right && <span className={capClass(right, "right")} style={style(right)}>{right.unit}</span>}
      {action}
    </div>
  );
}

/** A tick in its drawing's own units: `y` down from the top, as SVG counts. */
export interface AxisTick { v: number; y: number }

/** `frame` is the drawing's height in the ticks' units (an SVG's viewBox
 *  height; 1 for fractions); `height` is what that drawing measures on
 *  screen (px) — the axis stands beside it at the same size. */
export default function YAxis({ ticks, frame, side = "left", unit, height, cls, color, zoomable }: {
  ticks: readonly AxisTick[]; frame: number; side?: "left" | "right"; unit?: string; height: number;
  /** The series' colour class, for an axis that belongs to ONE line. */
  cls?: string;
  /** Or its colour itself (a line drawn in a CSS colour, not a class). */
  color?: string;
  /** A line chart's axis: a tap switches every chart on this tablet between "from 0" and fitted (owner, 2026-10-26).
   *  A bar chart's axis is always from 0. */
  zoomable?: boolean;
}) {
  const fit = useChartFit();
  const fromZero = fit === "zero";
  const tap = zoomable ? {
    role: "button", tabIndex: 0,
    title: fromZero ? "Fit to the values" : "Show from 0",
    "aria-label": fromZero ? "Y axis from 0: tap to fit it to the values" : "Y axis fitted: tap to show from 0",
    onClick: toggleChartFit,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleChartFit(); } },
  } : { "aria-hidden": true as const };
  // The ticks' own step, so every label is exact (fmtAxis).
  const step = ticks.length > 1 ? Math.abs(ticks[1].v - ticks[0].v) : undefined;
  return (
    <div className={`chart-yaxis ${side}${cls ? ` tint-${cls}` : ""}${zoomable ? " zoomable" : ""}`} style={{ height, ...(color ? { color } : {}) }} {...tap}>
      {unit && <span className="chart-yaxis-unit">{unit}</span>}
      {ticks.map((t) => (
        <span key={t.v} className="chart-yaxis-tick" style={{ bottom: `${(1 - t.y / frame) * 100}%` }}>{fmtAxis(t.v, step)}</span>
      ))}
    </div>
  );
}
