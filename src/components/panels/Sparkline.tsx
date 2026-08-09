// src/components/panels/Sparkline.tsx
// Dependency-free SVG line chart for one numeric series over ~24h. Now with
// recessive X/Y axes and a crosshair + tooltip on hover/touch (the value and
// time of the nearest datapoint). Width is measured (1 SVG unit = 1px) so axis
// text stays crisp instead of being stretched by preserveAspectRatio="none".

import { useCallback, useMemo, useState } from "react";
import type { HistoryPoint } from "@/types/ha.types";
import { useElementWidth } from "@/hooks/useElementWidth";
import { fmtChartValue, fmtChartTime, fmtChartStamp, nearestIndexByX } from "./chartUtils";

interface Props {
  data: HistoryPoint[];
  color?: string;
  height?: number;
  unit?: string;
  /** True while the history fetch is still in flight — see StateTimeline's
   *  `loading` prop for why this distinction matters. */
  loading?: boolean;
}

const M = { top: 8, right: 10, bottom: 18, left: 38 };

export default function Sparkline({ data, color = "var(--accent-teal)", height = 110, unit = "", loading }: Props) {
  // Span of the data itself: this chart scales its x-axis to what it was given.
  const spanHours = data.length > 1
    ? (data[data.length - 1].t - data[0].t) / 3_600_000 : 0;
  const [ref, W] = useElementWidth<HTMLDivElement>(320);
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (data.length < 2) return null;
    const xs = data.map((d) => d.t);
    const ys = data.map((d) => d.v);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const plotW = Math.max(1, W - M.left - M.right);
    const plotH = Math.max(1, height - M.top - M.bottom);
    const sx = (t: number) => M.left + ((t - minX) / spanX) * plotW;
    const sy = (v: number) => M.top + (1 - (v - minY) / spanY) * plotH;
    const pts = data.map((d) => ({ x: sx(d.t), y: sy(d.v), t: d.t, v: d.v }));
    return { pts, minX, maxX, minY, maxY, sx, sy };
  }, [data, W, height]);

  const onMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    setHover(nearestIndexByX(geom.pts, x));
  }, [geom, W]);

  if (!geom) {
    return loading
      ? <div ref={ref} className="state-timeline-skeleton" style={{ height }} />
      : <div ref={ref} className="muted body-text">Not enough history yet.</div>;
  }

  const polyline = geom.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const hp = hover != null ? geom.pts[hover] : null;
  const yTicks = [geom.maxY, (geom.maxY + geom.minY) / 2, geom.minY];
  const xTicks = [geom.minX, (geom.minX + geom.maxX) / 2, geom.maxX];

  return (
    <div ref={ref} className="spark-wrap">
      <svg
        className="sparkline" width={W} height={height} style={{ height, touchAction: "none" }}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((v, i) => {
          const y = geom.sy(v);
          return (
            <g key={`y${i}`}>
              <line x1={M.left} y1={y} x2={W - M.right} y2={y} className="spark-grid" />
              <text x={M.left - 5} y={y} textAnchor="end" dominantBaseline="middle" className="spark-axis">
                {fmtChartValue(v)}
              </text>
            </g>
          );
        })}
        {xTicks.map((t, i) => (
          <text
            key={`x${i}`} x={geom.sx(t)} y={height - 4}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            className="spark-axis"
          >
            {fmtChartTime(t)}
          </text>
        ))}
        <polyline points={polyline} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hp && (
          <g>
            <line x1={hp.x} y1={M.top} x2={hp.x} y2={height - M.bottom} className="spark-crosshair" />
            <circle cx={hp.x} cy={hp.y} r={3.5} fill={color} stroke="var(--bg-panel)" strokeWidth={1.5} />
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="spark-tip"
          style={{ left: hp.x, top: M.top, transform: `translateX(${hp.x > W / 2 ? "-100%" : "0"})` }}
        >
          <strong>{fmtChartValue(hp.v)}{unit ? ` ${unit}` : ""}</strong>
          {/* The tooltip earns the day when the window spans more than one;
              the axis ticks below stay bare, where the day would not fit. */}
          <span>{fmtChartStamp(hp.t, spanHours)}</span>
        </div>
      )}
    </div>
  );
}
