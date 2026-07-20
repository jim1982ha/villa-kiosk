// src/components/panels/DualSparkline.tsx
// Two history series sharing one 24h time axis, each on its OWN y-axis scale
// (e.g. temperature °C left, humidity % right) — for a physical sensor that
// reports as two separate HA entities (see config/deviceGroups.ts +
// DeviceGroupPanel). Dual-axis is a deliberate compact combo view here; the two
// y-axes are colour-matched to their series so which scale is which stays clear.
// Crosshair + tooltip reads BOTH series at the hovered time.

import { useCallback, useMemo, useState } from "react";
import type { HistoryPoint } from "@/types/ha.types";
import { useElementWidth } from "@/hooks/useElementWidth";
import { fmtChartValue, fmtChartTime, nearestIndexByX } from "./chartUtils";

interface Series {
  data: HistoryPoint[];
  color: string;
  unit?: string;
  label?: string;
}

interface Props {
  a: Series;
  b: Series;
  height?: number;
}

const M = { top: 8, right: 40, bottom: 18, left: 40 };

export default function DualSparkline({ a, b, height = 120 }: Props) {
  const [ref, W] = useElementWidth<HTMLDivElement>(320);
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (a.data.length < 2 && b.data.length < 2) return null;
    const allT = [...a.data, ...b.data].map((d) => d.t);
    const minX = Math.min(...allT), maxX = Math.max(...allT);
    const spanX = maxX - minX || 1;
    const plotW = Math.max(1, W - M.left - M.right);
    const plotH = Math.max(1, height - M.top - M.bottom);
    const sx = (t: number) => M.left + ((t - minX) / spanX) * plotW;

    const scaleOf = (data: HistoryPoint[]) => {
      const ys = data.map((d) => d.v);
      const minY = ys.length ? Math.min(...ys) : 0;
      const maxY = ys.length ? Math.max(...ys) : 1;
      const spanY = maxY - minY || 1;
      return {
        minY, maxY,
        sy: (v: number) => M.top + (1 - (v - minY) / spanY) * plotH,
      };
    };
    const sa = scaleOf(a.data);
    const sb = scaleOf(b.data);
    const ptsA = a.data.map((d) => ({ x: sx(d.t), y: sa.sy(d.v), t: d.t, v: d.v }));
    const ptsB = b.data.map((d) => ({ x: sx(d.t), y: sb.sy(d.v), t: d.t, v: d.v }));
    // The crosshair rides the denser series' x positions.
    const railPts = ptsA.length >= ptsB.length ? ptsA : ptsB;
    return { minX, maxX, sx, sa, sb, ptsA, ptsB, railPts };
  }, [a.data, b.data, W, height]);

  const onMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!geom || !geom.railPts.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    setHover(nearestIndexByX(geom.railPts, x));
  }, [geom, W]);

  if (!geom) return <div ref={ref} className="muted body-text">Not enough history yet.</div>;

  const toStr = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const xTicks = [geom.minX, (geom.minX + geom.maxX) / 2, geom.maxX];

  const railX = hover != null ? geom.railPts[hover]?.x : undefined;
  const nearInSeries = (pts: { x: number; y: number; v: number; t: number }[]) =>
    railX != null && pts.length ? pts[nearestIndexByX(pts, railX)] : undefined;
  const hpA = nearInSeries(geom.ptsA);
  const hpB = nearInSeries(geom.ptsB);

  return (
    <div ref={ref} className="spark-wrap">
      <svg
        className="sparkline" width={W} height={height} style={{ height, touchAction: "none" }}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}
      >
        {/* Left Y axis (series a) */}
        {a.data.length >= 2 && [geom.sa.maxY, geom.sa.minY].map((v, i) => (
          <text key={`ya${i}`} x={M.left - 5} y={geom.sa.sy(v)} textAnchor="end" dominantBaseline="middle"
            className="spark-axis" style={{ fill: a.color }}>{fmtChartValue(v)}</text>
        ))}
        {/* Right Y axis (series b) */}
        {b.data.length >= 2 && [geom.sb.maxY, geom.sb.minY].map((v, i) => (
          <text key={`yb${i}`} x={W - M.right + 5} y={geom.sb.sy(v)} textAnchor="start" dominantBaseline="middle"
            className="spark-axis" style={{ fill: b.color }}>{fmtChartValue(v)}</text>
        ))}
        {xTicks.map((t, i) => (
          <text key={`x${i}`} x={geom.sx(t)} y={height - 4}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            className="spark-axis">{fmtChartTime(t)}</text>
        ))}
        {a.data.length >= 2 && (
          <polyline points={toStr(geom.ptsA)} fill="none" stroke={a.color} strokeWidth={2} strokeLinejoin="round" />
        )}
        {b.data.length >= 2 && (
          <polyline points={toStr(geom.ptsB)} fill="none" stroke={b.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray="4 3" />
        )}
        {railX != null && (
          <g>
            <line x1={railX} y1={M.top} x2={railX} y2={height - M.bottom} className="spark-crosshair" />
            {hpA && <circle cx={hpA.x} cy={hpA.y} r={3.5} fill={a.color} stroke="var(--bg-panel)" strokeWidth={1.5} />}
            {hpB && <circle cx={hpB.x} cy={hpB.y} r={3.5} fill={b.color} stroke="var(--bg-panel)" strokeWidth={1.5} />}
          </g>
        )}
      </svg>
      {railX != null && (
        <div className="spark-tip" style={{ left: railX, top: M.top, transform: `translateX(${railX > W / 2 ? "-100%" : "0"})` }}>
          {hpA && <span><span style={{ color: a.color }}>●</span> {fmtChartValue(hpA.v)}{a.unit ? ` ${a.unit}` : ""}</span>}
          {hpB && <span><span style={{ color: b.color }}>┄</span> {fmtChartValue(hpB.v)}{b.unit ? ` ${b.unit}` : ""}</span>}
          <span className="spark-tip-time">{fmtChartTime((hpA ?? hpB)!.t)}</span>
        </div>
      )}
    </div>
  );
}
