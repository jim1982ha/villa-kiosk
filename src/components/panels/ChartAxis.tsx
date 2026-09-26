// src/components/panels/ChartAxis.tsx
// The y-axis every history chart in the Weather and Energy windows draws
// (owner, 2026-09-26: "always show the Y-axis details, so the user knows the
// value displayed"). Labels are placed by fraction of the plot's height, so
// the same axis stands beside an SVG plot and a column of HTML bars; the
// ticks themselves are chartGeometry's (a line chart's series.ticks) or
// barChart's (barLayout.ticks) — one rule, niceTicks, and one label, fmtAxis.

import { fmtAxis } from "@/utils/chartGeometry";

/** A tick in its drawing's own units: `y` down from the top, as SVG counts. */
export interface AxisTick { v: number; y: number }

/** `frame` is the drawing's height in the ticks' units (an SVG's viewBox
 *  height; 1 for fractions); `height` is what that drawing measures on
 *  screen (px) — the axis stands beside it at the same size. */
export default function YAxis({ ticks, frame, side = "left", unit, height, cls, color }: {
  ticks: readonly AxisTick[]; frame: number; side?: "left" | "right"; unit?: string; height: number;
  /** The series' colour class, for an axis that belongs to ONE line. */
  cls?: string;
  /** Or its colour itself (a line drawn in a CSS colour, not a class). */
  color?: string;
}) {
  // The ticks' own step, so every label is exact (fmtAxis).
  const step = ticks.length > 1 ? Math.abs(ticks[1].v - ticks[0].v) : undefined;
  return (
    <div className={`chart-yaxis ${side}${cls ? ` tint-${cls}` : ""}`} style={{ height, ...(color ? { color } : {}) }} aria-hidden="true">
      {unit && <span className="chart-yaxis-unit">{unit}</span>}
      {ticks.map((t) => (
        <span key={t.v} className="chart-yaxis-tick" style={{ bottom: `${(1 - t.y / frame) * 100}%` }}>{fmtAxis(t.v, step)}</span>
      ))}
    </div>
  );
}
