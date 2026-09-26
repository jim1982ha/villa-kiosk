// src/components/panels/DualSparkline.tsx
// Two history series sharing one 24h time axis, each on its OWN y-axis scale
// (e.g. temperature °C left, humidity % right) — for a physical sensor that
// reports as two separate HA entities (see config/deviceGroups.ts +
// DeviceGroupPanel). Dual-axis is a deliberate compact combo view here; the two
// y-axes are colour-matched to their series so which scale is which stays clear.
// Crosshair + tooltip reads BOTH series at the hovered time.

import { useCallback, useMemo, useState } from "react";
import type { HistoryPoint, HistoryGap } from "@/types/ha.types";
import { chartWindow, type TimeWindow } from "@/utils/lineChart";
import { chartGeometry, fmtAxis } from "@/utils/chartGeometry";
import { STATUS_COLOR } from "@/utils/stateColors";
import { useElementWidth } from "@/hooks/useElementWidth";
import { fmtChartValue, fmtChartTick } from "./chartUtils";
import ChartTip from "./ChartTip";

interface Series {
  data: HistoryPoint[];
  /** Stretches in which this series reported nothing usable. */
  gaps?: HistoryGap[];
  color: string;
  unit?: string;
  label?: string;
}

interface Props {
  a: Series;
  b: Series;
  /** The span that was asked for — the shared x-axis. See lineChart.ts. */
  window?: TimeWindow;
  height?: number;
}

const M = { top: 8, right: 40, bottom: 18, left: 40 };

export default function DualSparkline({ a, b, window, height = 120 }: Props) {
  const [ref, W] = useElementWidth<HTMLDivElement>(320);
  const [hoverT, setHoverT] = useState<number | null>(null);

  // Each series on its OWN y-scale ("own"), both on the window's x-axis — and
  // ⚠️ A BAND PER SERIES, IN ITS OWN HALF, NOT ONE FULL-HEIGHT BAND: a band
  // spanning the full height could not say WHICH of the two reported nothing.
  // Half-height bands inherit the left/right reading the axes already
  // establish; both out at once fills the height. chartGeometry slices the
  // plot per series for every chart, so the Weather charts now say it too.
  const geom = useMemo(() => {
    if (a.data.length < 2 && b.data.length < 2) return null;
    const w = chartWindow(window, a.data, b.data);
    if (!w) return null;
    return chartGeometry(w, [
      { pts: a.data, gaps: a.gaps ?? [], scale: "own" },
      { pts: b.data, gaps: b.gaps ?? [], scale: "own" },
    ], { left: M.left, right: Math.max(M.left + 1, W - M.right), top: M.top, bottom: Math.max(M.top + 1, height - M.bottom) });
  }, [a.data, a.gaps, b.data, b.gaps, window, W, height]);

  const onMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverT(geom.tAt(((e.clientX - rect.left) / rect.width) * W));
  }, [geom, W]);

  if (!geom) return <div ref={ref} className="muted body-text">Not enough history yet.</div>;

  const [ga, gb] = geom.series;
  const toStr = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  // The reading in force in EACH series at the pointer — none inside that
  // series' own outage — under one stamp (chartGeometry.hover).
  const hover = hoverT === null ? null : geom.hover(hoverT);
  const [hpA, hpB] = hover ? hover.readings : [null, null];

  return (
    <div ref={ref} className="spark-wrap">
      <svg
        className="sparkline" width={W} height={height} style={{ height, touchAction: "none" }}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHoverT(null)}
      >
        {/* Left Y axis (series a) */}
        {/* Each axis: its series' round ticks (chartGeometry), the app's one label. */}
        {a.data.length >= 2 && ga.ticks.map((tk) => (
          <text key={`ya${tk.v}`} x={M.left - 5} y={tk.y} textAnchor="end" dominantBaseline="middle"
            className="spark-axis" style={{ fill: a.color }}>{fmtAxis(tk.v)}</text>
        ))}
        {/* Right Y axis (series b) */}
        {b.data.length >= 2 && gb.ticks.map((tk) => (
          <text key={`yb${tk.v}`} x={W - M.right + 5} y={tk.y} textAnchor="start" dominantBaseline="middle"
            className="spark-axis" style={{ fill: b.color }}>{fmtAxis(tk.v)}</text>
        ))}
        {/* ⚠️ FIRST IN THE SVG so the shading sits BEHIND the grid and both
            lines — SVG paints in document order and has no z-index. */}
        {[...ga.bands, ...gb.bands].map((bd, i) => (
          <rect key={`g${i}`} x={bd.x} y={bd.y} width={bd.w} height={bd.h} fill={STATUS_COLOR.unavailable} opacity={0.18} />
        ))}
        {geom.ticks.map((t, i) => (
          <text key={`x${i}`} x={geom.sx(t)} y={height - 4}
            textAnchor={i === 0 ? "start" : i === geom.ticks.length - 1 ? "end" : "middle"}
            className="spark-axis">{fmtChartTick(t, geom.spanHours)}</text>
        ))}
        {ga.runs.map((r, i) => (
          <polyline key={`ra${i}`} points={toStr(r)} fill="none" stroke={a.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {gb.runs.map((r, i) => (
          <polyline key={`rb${i}`} points={toStr(r)} fill="none" stroke={b.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray="4 3" />
        ))}
        {hover && (
          <g>
            <line x1={hover.x} y1={M.top} x2={hover.x} y2={height - M.bottom} className="spark-crosshair" />
            {hpA && <circle cx={hpA.x} cy={hpA.y} r={3.5} fill={a.color} stroke="var(--bg-panel)" strokeWidth={1.5} />}
            {hpB && <circle cx={hpB.x} cy={hpB.y} r={3.5} fill={b.color} stroke="var(--bg-panel)" strokeWidth={1.5} />}
          </g>
        )}
      </svg>
      {hover && (
        <ChartTip left={hover.x} top={M.top} flip={hover.x > W / 2} t={hover.t} spanHours={geom.spanHours}
          rows={[
            ...(hpA ? [{ key: "a", marker: <span style={{ color: a.color }}>●</span>, text: `${fmtChartValue(hpA.v)}${a.unit ? ` ${a.unit}` : ""}` }] : []),
            ...(hpB ? [{ key: "b", marker: <span style={{ color: b.color }}>┄</span>, text: `${fmtChartValue(hpB.v)}${b.unit ? ` ${b.unit}` : ""}` }] : []),
          ]} />
      )}
    </div>
  );
}
