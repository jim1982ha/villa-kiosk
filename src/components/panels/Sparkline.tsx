// src/components/panels/Sparkline.tsx
// Dependency-free SVG line chart for one numeric series over ~24h. Now with
// recessive X/Y axes and a crosshair + tooltip on hover/touch (the reading in
// force under the pointer, and when it was taken). Width is measured (1 SVG unit = 1px) so axis
// text stays crisp instead of being stretched by preserveAspectRatio="none".

import { useCallback, useMemo, useState } from "react";
import type { HistoryPoint, HistoryGap } from "@/types/ha.types";
import { chartWindow, type TimeWindow } from "@/utils/lineChart";
import { chartGeometry } from "@/utils/chartGeometry";
import { STATUS_COLOR } from "@/utils/stateColors";
import { useElementWidth } from "@/hooks/useElementWidth";
import { fmtChartValue, fmtChartTick } from "./chartUtils";
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
  const [hoverT, setHoverT] = useState<number | null>(null);

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

  const onMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverT(geom.tAt(((e.clientX - rect.left) / rect.width) * W));
  }, [geom, W]);

  if (!geom) {
    return loading
      ? <div ref={ref} className="state-timeline-skeleton" style={{ height }} />
      : <div ref={ref} className="muted body-text">Not enough history yet.</div>;
  }

  const line = geom.series[0];
  const hover = hoverT === null ? null : geom.hover(hoverT);
  const hp = hover?.readings[0] ?? null;
  const yTicks = [line.hi, (line.hi + line.lo) / 2, line.lo];

  return (
    <div ref={ref} className="spark-wrap">
      <svg
        className="sparkline" width={W} height={height} style={{ height, touchAction: "none" }}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHoverT(null)}
      >
        {/* ⚠️ FIRST IN THE SVG, so the band is BEHIND the grid and the line.
            SVG has no z-index — paint order is document order — so moving this
            below the polyline would hide the data behind the shading. */}
        {line.bands.map((b, i) => (
          <rect key={`gap${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={STATUS_COLOR.unavailable} opacity={0.18} />
        ))}
        {yTicks.map((v, i) => {
          const y = line.sy(v);
          return (
            <g key={`y${i}`}>
              <line x1={M.left} y1={y} x2={W - M.right} y2={y} className="spark-grid" />
              <text x={M.left - 5} y={y} textAnchor="end" dominantBaseline="middle" className="spark-axis">
                {fmtChartValue(v)}
              </text>
            </g>
          );
        })}
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
        <ChartTip left={hover.x} top={M.top} flip={hover.x > W / 2} t={hover.t} spanHours={geom.spanHours}
          rows={[{ key: "v", text: `${fmtChartValue(hp.v)}${unit ? ` ${unit}` : ""}` }]} />
      )}
    </div>
  );
}
