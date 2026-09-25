// src/components/panels/DualSparkline.tsx
// Two history series sharing one 24h time axis, each on its OWN y-axis scale
// (e.g. temperature °C left, humidity % right) — for a physical sensor that
// reports as two separate HA entities (see config/deviceGroups.ts +
// DeviceGroupPanel). Dual-axis is a deliberate compact combo view here; the two
// y-axes are colour-matched to their series so which scale is which stays clear.
// Crosshair + tooltip reads BOTH series at the hovered time.

import { useCallback, useMemo, useState } from "react";
import type { HistoryPoint, HistoryGap } from "@/types/ha.types";
import { chartWindow, timeScale, lineRuns, outageBands, type TimeWindow } from "@/utils/lineChart";
import { STATUS_COLOR } from "@/utils/stateColors";
import { useElementWidth } from "@/hooks/useElementWidth";
import { fmtChartValue, fmtChartTime, fmtChartStamp, nearestIndexByX } from "./chartUtils";


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
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (a.data.length < 2 && b.data.length < 2) return null;
    const w = chartWindow(window, a.data, b.data);
    if (!w) return null;
    const minX = w.from, maxX = w.to;
    const plotW = Math.max(1, W - M.left - M.right);
    const plotH = Math.max(1, height - M.top - M.bottom);
    const right = M.left + plotW;
    const sx = timeScale(w, M.left, right);

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
    // The crosshair rides the denser series' x positions. Both LINES come from
    // the one lineRuns (stepped, held, split) — the rule used to be written
    // out here and in Sparkline, and half a rollout is this repository's
    // most repeated defect.
    const runsOf = (data: HistoryPoint[], gaps: readonly HistoryGap[] | undefined, sy: (v: number) => number) =>
      lineRuns(data, gaps ?? [], w).map((r) => r.map((d) => ({ x: sx(d.t), y: sy(d.v), t: d.t })));
    const railPts = ptsA.length >= ptsB.length ? ptsA : ptsB;

    // ⚠️ A BAND PER SERIES, IN ITS OWN HALF — NOT ONE FULL-HEIGHT BAND. Two
    // series share this plot and each has its own axis (a on the left, b on the
    // right), so a band spanning the full height could not say WHICH of them
    // reported nothing. Half-height bands inherit the same left/right reading
    // the axes already establish; both out at once fills the height, which is
    // the unambiguous case anyway.
    return {
      minX, maxX, sx, sa, sb, ptsA, ptsB, railPts, plotH,
      bandsA: outageBands(a.gaps ?? [], sx, M.left, right), bandsB: outageBands(b.gaps ?? [], sx, M.left, right),
      runsA: runsOf(a.data, a.gaps, sa.sy), runsB: runsOf(b.data, b.gaps, sb.sy),
      spanHours: (maxX - minX) / 3_600_000,
    };
  }, [a.data, a.gaps, b.data, b.gaps, window, W, height]);

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
        {/* ⚠️ FIRST IN THE SVG so the shading sits BEHIND the grid and both
            lines — SVG paints in document order and has no z-index. */}
        {geom.bandsA.map((bd, i) => (
          <rect key={`ga${i}`} x={bd.x} y={M.top} width={bd.w} height={Math.max(1, geom.plotH / 2)}
            fill={STATUS_COLOR.unavailable} opacity={0.18} />
        ))}
        {geom.bandsB.map((bd, i) => (
          <rect key={`gb${i}`} x={bd.x} y={M.top + geom.plotH / 2} width={bd.w} height={Math.max(1, geom.plotH / 2)}
            fill={STATUS_COLOR.unavailable} opacity={0.18} />
        ))}
        {xTicks.map((t, i) => (
          <text key={`x${i}`} x={geom.sx(t)} y={height - 4}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            className="spark-axis">{fmtChartTime(t)}</text>
        ))}
        {geom.runsA.filter((r) => r.length >= 2).map((r, i) => (
          <polyline key={`ra${i}`} points={toStr(r)} fill="none" stroke={a.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {geom.runsB.filter((r) => r.length >= 2).map((r, i) => (
          <polyline key={`rb${i}`} points={toStr(r)} fill="none" stroke={b.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray="4 3" />
        ))}
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
          <span className="spark-tip-time">{fmtChartStamp((hpA ?? hpB)!.t, geom.spanHours)}</span>
        </div>
      )}
    </div>
  );
}
