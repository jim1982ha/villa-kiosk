// src/components/panels/ChartAxis.tsx
// The y-axis every history chart in the Weather and Energy windows draws
// (owner, 2026-09-26: "always show the Y-axis details, so the user knows the
// value displayed"). Labels are placed by fraction of the plot's height, so
// the same axis stands beside an SVG plot and a column of HTML bars; the
// ticks themselves are chartGeometry.niceTicks'.

import { fmtAxis } from "@/utils/chartGeometry";

export interface AxisTick { v: number; /** 0 = bottom of the plot, 1 = top. */ at: number }

/** `height` is the PLOT's height (px), so the ticks line up with it and not
 *  with the time labels under it. */
export default function YAxis({ ticks, side = "left", unit, height }: { ticks: AxisTick[]; side?: "left" | "right"; unit?: string; height: number }) {
  return (
    <div className={`chart-yaxis ${side}`} style={{ height }} aria-hidden="true">
      {unit && <span className="chart-yaxis-unit">{unit}</span>}
      {ticks.map((t) => (
        <span key={t.v} className="chart-yaxis-tick" style={{ bottom: `${t.at * 100}%` }}>{fmtAxis(t.v)}</span>
      ))}
    </div>
  );
}
