// src/components/panels/LineChart.tsx
// THE app's line chart — the device panels' history (one series, or two on
// their own scales) and every Weather chart — as BarChart is its bar chart.
// Geometry is utils/chartGeometry's: the scales, the stepped runs held to the
// window's end and broken at outages, a band per series in its own slice, the
// round y-ticks and the hover answer. This draws them.
//
// ⚠️ THREE RENDERERS OVER ONE GEOMETRY (round 9, 2.496.144): Sparkline,
// DualSparkline and the Weather window's ChartTile each drew the bands, grid,
// runs, crosshair and tooltip themselves — the outage band written three
// times, two axis models (SVG text in the device panels, the HTML YAxis in
// Weather), three "no data" wordings. 2.496.118 found the chart checks had
// quietly stopped looking at three of six charts — the symptom.

import type { ReactNode } from "react";
import type { HistoryPoint, HistoryGap } from "@/types/ha.types";
import { drawableWindow, type TimeWindow } from "@/utils/lineChart";
import { chartGeometry, type ChartGeometry } from "@/utils/chartGeometry";
import type { HistoryStatus } from "@/utils/statisticsSeries";
import { STATUS_COLOR } from "@/utils/stateColors";
import { fmtChartValue, fmtChartTick, fmtChartStamp } from "./chartUtils";
import { useChartPointer } from "./useChartPointer";
import ChartTip from "./ChartTip";
import YAxis, { type AxisTick } from "./ChartAxis";

export interface LineSpec {
  pts: readonly HistoryPoint[];
  gaps?: readonly HistoryGap[];
  /** In the tooltip; and the right axis' caption when it has no unit. */
  label: string;
  /** After the value in the tooltip, and over its axis ("°", " km/h"). */
  unit?: string;
  /** Its colour: a series class (`out`, `water`, …; styles) or a CSS colour. */
  cls?: string;
  color?: string;
  dashed?: boolean;
  /** Filled down to the plot's floor. */
  area?: boolean;
  /** Its y-scale: shared with the others (default), its own, or its own from 0.
   *  The first line after the first on a scale of its own gets the right axis. */
  scale?: "shared" | "own" | "fromZero";
}

/** The drawing's own units: the SVG stretches to the tile's width. */
const W = 320, TOP = 12;

/** What a chart says when it has nothing to draw — three different facts. */
export function ChartEmpty({ status, height }: { status: HistoryStatus; height?: number }) {
  if (status === "loading") return <div className="state-timeline-skeleton weather-chart" style={height ? { height } : undefined} />;
  return <div className="muted body-text weather-chart-empty">{status === "failed" ? "Couldn't load this history." : "Not enough history yet."}</div>;
}

/** The x labels, under the PLOT: start, middle and the end — "now" when the
 *  window ends within five minutes of it. */
export function TimeAxis({ g, right }: { g: ChartGeometry | null; right?: boolean }) {
  if (!g) return <div className="weather-axis"><span>&nbsp;</span></div>;
  const [a, b, c] = g.ticks;
  const endsNow = Math.abs(c - Date.now()) < 5 * 60_000;
  return (
    <div className={`weather-axis under-yaxis${right ? " right" : ""}`}>
      <span>{fmtChartTick(a, g.spanHours)}</span><span>{fmtChartTick(b, g.spanHours)}</span>
      <span>{endsNow ? "now" : fmtChartTick(c, g.spanHours)}</span>
    </div>
  );
}

const keyOf = (l: LineSpec): ReactNode => (l.cls
  ? <i className={`key ${l.cls.split(" ")[0]}`} />
  : <span style={{ color: l.color }}>{l.dashed ? "┄" : "●"}</span>);

export default function LineChart({ lines, window, height = 150, status = "ready", label }: {
  lines: readonly LineSpec[];
  /** The span that was asked for — the x-axis. Omitted: the readings' own span. */
  window?: TimeWindow;
  /** The plot's height on screen, px. */
  height?: number;
  status?: HistoryStatus;
  /** Its accessible name. */
  label: string;
}) {
  const H = height, BOT = height - 12;
  const plot = { left: 0, right: W, top: TOP, bottom: BOT };
  // A line with no readings still has its outage, and its band says so
  // (every line is kept); whether there is anything to draw is lineChart's.
  const w = drawableWindow(window, ...lines.map((l) => l.pts));
  const g = w ? chartGeometry(w, lines.map((l) => ({ pts: l.pts, gaps: l.gaps ?? [], scale: l.scale ?? "shared" })), plot, 0.08) : null;
  const { frac, handlers } = useChartPointer<SVGSVGElement>();
  if (!g) return <><ChartEmpty status={status} height={height} /><TimeAxis g={null} /></>;

  const leftAxis: readonly AxisTick[] = g.series[0].ticks;
  const ownAt = lines.findIndex((l, i) => i > 0 && (l.scale ?? "shared") !== "shared");
  const right = ownAt > 0 ? lines[ownAt] : null;
  const hover = frac !== null ? g.hover(g.tAt(frac * W)) : null;
  const style = (l: LineSpec) => (l.color ? { stroke: l.color } : undefined);
  return (
    <>
      <div className="chart-with-axis has-unit">
        <YAxis height={H} frame={H} unit={lines[0].unit?.trim()} ticks={leftAxis} cls={lines[0].cls?.split(" ")[0]} color={lines[0].color} />
        <div className="spark-wrap weather-chart-wrap">
          <svg className="weather-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}
            style={{ height: H, touchAction: "none" }} {...handlers}>
            <g className="chart-grid">{leftAxis.map((t) => <line key={t.v} x1="0" y1={t.y} x2={W} y2={t.y} />)}</g>
            {/* A band per line, in its own slice of the plot: which sensor was
                out is part of the fact. Before the lines — SVG paints in order. */}
            {g.series.flatMap((s, i) => s.bands.map((b, j) => (
              <rect key={`gap${i}-${j}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={STATUS_COLOR.unavailable} opacity={0.18} />
            )))}
            {g.series.map((sg, i) => {
              const l = lines[i];
              const cls = `${l.cls ?? ""}${l.dashed ? " dashed" : ""}`;
              return (
                <g key={i}>
                  {sg.runs.map((run, j) => {
                    const pts = run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
                    return (
                      <g key={j}>
                        {l.area && <path d={`M${run[0].x.toFixed(1)},${BOT} L${pts.join(" L")} L${run[run.length - 1].x.toFixed(1)},${BOT} Z`}
                          className={`chart-area ${l.cls ?? ""}`} style={l.color ? { fill: l.color, opacity: 0.25 } : undefined} />}
                        <polyline points={pts.join(" ")} className={`chart-line ${cls}`} style={style(l)} vectorEffect="non-scaling-stroke" />
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {hover && <line x1={hover.x} y1={TOP} x2={hover.x} y2={BOT} className="spark-crosshair" vectorEffect="non-scaling-stroke" />}
          </svg>
          {hover && (
            <ChartTip x={hover.x / W} y={TOP / H} stamp={fmtChartStamp(hover.t, g.spanHours)}
              rows={lines.flatMap((l, i) => {
                const r = hover.readings[i];
                return r ? [{ key: `${i}`, marker: keyOf(l), text: `${lines.length > 1 ? `${l.label} ` : ""}${fmtChartValue(r.v)}${l.unit ?? ""}` }] : [];
              })} />
          )}
        </div>
        {/* The right axis is the colour of the line it measures. */}
        {right && <YAxis side="right" height={H} frame={H} unit={right.unit?.trim() || right.label} ticks={g.series[ownAt].ticks}
          cls={right.cls?.split(" ")[0]} color={right.color} />}
      </div>
      <TimeAxis g={g} right={!!right} />
    </>
  );
}
