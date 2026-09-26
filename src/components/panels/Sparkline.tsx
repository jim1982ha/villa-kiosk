// src/components/panels/Sparkline.tsx
// Dependency-free SVG line chart for one numeric series over ~24h. Now with
// recessive X/Y axes and a crosshair + tooltip on hover/touch (the reading in
// force under the pointer, and when it was taken). Width is measured (1 SVG unit = 1px) so axis
// text stays crisp instead of being stretched by preserveAspectRatio="none".

import { useMemo } from "react";
import type { HistoryPoint, HistoryGap } from "@/types/ha.types";
import { chartWindow, type TimeWindow } from "@/utils/lineChart";
import { chartGeometry, fmtAxis } from "@/utils/chartGeometry";
import { STATUS_COLOR } from "@/utils/stateColors";
import { useElementWidth } from "@/hooks/useElementWidth";
import { fmtChartValue, fmtChartTick, fmtChartStamp } from "./chartUtils";
import { useChartPointer } from "./useChartPointer";
import ChartTip from "./ChartTip";

interface Props {
  data: HistoryPoint[];
  /** Stretches in which the entity reported nothing usable. Shaded, and the
   *  line is broken across them — see utils/historyGaps for why both. */
  gaps?: HistoryGap[];
  /** The span that was asked for (HistorySeries.window). Drawn as the x-axis,
   *  so an outage running to now reaches the right edge — see lineChart.ts.
   *  Omitted, the chart spans its own readings, as it always did. */
  window?: TimeWindow;
  color?: string;
  height?: number;
  unit?: string;
  /** True while the history fetch is still in flight — see StateTimeline's
   *  `loading` prop for why this distinction matters. */
  loading?: boolean;
}

const M = { top: 8, right: 10, bottom: 18, left: 38 };

export default function Sparkline({ data, gaps = [], window, color = "var(--accent-teal)", height = 110, unit = "", loading }: Props) {
  const [ref, W] = useElementWidth<HTMLDivElement>(320);
  const { frac, handlers } = useChartPointer<SVGSVGElement>();

  // Scales, the line (stepped, held to the window's end, split at outages),
  // the bands, the ticks and the hover answer: utils/chartGeometry, the one
  // module every history chart draws from.
  const geom = useMemo(() => {
    // ONE reading is a line when the window is known: a sensor that held one
    // value all day (no rain: 0 mm since midnight) comes back from the recorder
    // as a single row, and it HOLDS to the window's end (lineRuns). It read
    // "Not enough history" — about a gauge that had reported all day.
    if (data.length === 0 || (data.length < 2 && !(window && window.to > window.from))) return null;
    const w = chartWindow(window, data);
    if (!w) return null;
    return chartGeometry(w, [{ pts: data, gaps }],
      { left: M.left, right: Math.max(M.left + 1, W - M.right), top: M.top, bottom: Math.max(M.top + 1, height - M.bottom) });
  }, [data, gaps, window, W, height]);

  if (!geom) {
    return loading
      ? <div ref={ref} className="state-timeline-skeleton" style={{ height }} />
      : <div ref={ref} className="muted body-text">Not enough history yet.</div>;
  }

  const line = geom.series[0];
  const hover = frac === null ? null : geom.hover(geom.tAt(frac * W));
  const hp = hover?.readings[0] ?? null;

  return (
    <div ref={ref} className="spark-wrap">
      <svg
        className="sparkline" width={W} height={height} style={{ height, touchAction: "none" }}
        {...handlers}
      >
        {/* ⚠️ FIRST IN THE SVG, so the band is BEHIND the grid and the line.
            SVG has no z-index — paint order is document order — so moving this
            below the polyline would hide the data behind the shading. */}
        {line.bands.map((b, i) => (
          <rect key={`gap${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={STATUS_COLOR.unavailable} opacity={0.18} />
        ))}
        {/* The y-axis: chartGeometry's round ticks, the app's one axis label. */}
        {line.ticks.map((tk) => (
          <g key={`y${tk.v}`}>
            <line x1={M.left} y1={tk.y} x2={W - M.right} y2={tk.y} className="spark-grid" />
            <text x={M.left - 5} y={tk.y} textAnchor="end" dominantBaseline="middle" className="spark-axis">
              {fmtAxis(tk.v)}
            </text>
          </g>
        ))}
        {geom.ticks.map((t, i) => (
          <text
            key={`x${i}`} x={geom.sx(t)} y={height - 4}
            textAnchor={i === 0 ? "start" : i === geom.ticks.length - 1 ? "end" : "middle"}
            className="spark-axis"
          >
            {fmtChartTick(t, geom.spanHours)}
          </text>
        ))}
        {line.runs.map((r, i) => (
          <polyline key={`run${i}`} points={r.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover && hp && (
          <g>
            <line x1={hover.x} y1={M.top} x2={hover.x} y2={height - M.bottom} className="spark-crosshair" />
            <circle cx={hp.x} cy={hp.y} r={3.5} fill={color} stroke="var(--bg-panel)" strokeWidth={1.5} />
          </g>
        )}
      </svg>
      {hover && hp && (
        <ChartTip x={hover.x / W} y={M.top / height} stamp={fmtChartStamp(hover.t, geom.spanHours)}
          rows={[{ key: "v", text: `${fmtChartValue(hp.v)}${unit ? ` ${unit}` : ""}` }]} />
      )}
    </div>
  );
}
