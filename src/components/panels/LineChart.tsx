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

import { useId, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import type { HistoryPoint, HistoryGap } from "@/types/ha.types";
import { drawableWindow, type TimeWindow } from "@/utils/lineChart";
import { chartGeometry, type ChartGeometry } from "@/utils/chartGeometry";
import { emptyHistoryText, type HistoryStatus } from "@/utils/statisticsSeries";
import { NOT_KEPT_COLOR, STATUS_COLOR } from "@/utils/stateColors";
import { fmtChartValue, fmtChartTick, fmtStepStamp, fmtOutage, keptWords } from "./chartUtils";
import { activeRange, type KeptChart, type ValueRange } from "@/utils/rangeFilter";
import ChartRangeSlider, { RangeChip, rangeWords } from "./ChartRangeSlider";
import { formatUnitValue } from "@/utils/entityValue";
import { useChartPointer } from "./useChartPointer";
import ChartTip from "./ChartTip";
import YAxis, { ChartUnitLine, FitMark, useChartFit, type AxisTick } from "./ChartAxis";

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

/** A range filter on a one-line chart (owner, 2026-10-26): the slider beside its left axis, the left-out sides
 *  hatched over the plot, and the chip on the unit line. NumericHistory filters the line and closes it up
 *  (rangeFilter.keptChart), and passes it as `lines[0]` on its own window; the axis holds `base` too. The dates and the
 *  tooltip read the kept steps' real times, and a ribbon in the empty strip under the plot shows where they were in
 *  the period: no line or row is added, so nothing moves and nothing is left empty without it. */
export interface ChartFilter {
  /** The chart's values unfiltered: its axis holds them. */
  base: readonly HistoryPoint[];
  /** The range chosen (±Infinity: no limit on that side), or null: all. */
  range: ValueRange | null;
  /** A range, or null for all (no limit on either side is all). */
  onChange: (r: ValueRange | null) => void;
  /** "loading" while the finer values come (the line is drawn unfiltered meanwhile), "failed" when they could not be
   *  read. */
  state: "ready" | "loading" | "failed";
  /** The chart closed up, once filtered ("ready"). */
  kept?: KeptChart | null;
}

/** The drawing's own units: the SVG stretches to the tile's width. */
const W = 320, TOP = 12;

/** What a chart says when it has nothing to draw — three different facts
 *  (emptyHistoryText). `bar` is the state timeline's slim skeleton. */
export function ChartEmpty({ status, height, bar }: { status: HistoryStatus; height?: number; bar?: boolean }) {
  const text = emptyHistoryText(status);
  if (text === null) {
    return <div className={bar ? "state-timeline-skeleton" : "state-timeline-skeleton weather-chart"} style={height ? { height } : undefined} />;
  }
  return <div className={bar ? "muted body-text" : "muted body-text weather-chart-empty"}>{text}</div>;
}

/** The x labels, under the PLOT: start, middle and the end — "now" when the window ends within five minutes of it. In
 *  the row's empty left corner, by the axis' foot, the axis fit (ChartAxis.FitMark): under the slider when the chart
 *  has one, else under the axis numbers. */
export function TimeAxis({ g, right, slider }: { g: ChartGeometry | null; right?: boolean; slider?: boolean }) {
  if (!g) return <div className="weather-axis"><span>&nbsp;</span></div>;
  const [a, b, c] = g.ticks;
  const endsNow = Math.abs(c - Date.now()) < 5 * 60_000;
  // a label that repeats the one before it is left blank (a closed-up chart of one or two steps), its place kept
  const words = [fmtChartTick(a, g.spanHours), fmtChartTick(b, g.spanHours), endsNow ? "now" : fmtChartTick(c, g.spanHours)];
  return (
    <div className={`weather-axis under-yaxis${right ? " right" : ""}${slider ? " beside-range" : ""}`}>
      <span className="chart-fit-corner"><FitMark /></span>
      {words.map((w, i) => <span key={i}>{i > 0 && w === words[i - 1] ? "\u00a0" : w}</span>)}
    </div>
  );
}

const keyOf = (l: LineSpec): ReactNode => (l.cls
  ? <i className={`key ${l.cls.split(" ")[0]}`} />
  : <span style={{ color: l.color }}>{l.dashed ? "┄" : "●"}</span>);

export default function LineChart({ lines, window, height = 150, status, label, stepMs, filter, onExpand }: {
  lines: readonly LineSpec[];
  /** The span that was asked for — the x-axis. Omitted: the readings' own span. */
  window?: TimeWindow;
  /** The plot's height on screen, px. */
  height?: number;
  /** REQUIRED: a chart that forgot it said "Not enough history yet" while
   *  still loading (the device group, until 2.496.188). */
  status: HistoryStatus;
  /** Its accessible name. */
  label: string;
  /** REQUIRED: the step its values are (five minutes, an hour, a day, a week): the tooltip says a value's moment at it —
   *  a day's value never with a clock time (chartUtils.fmtStepStamp, owner 2026-10-20). */
  stepMs: number;
  /** A range filter on its one line (NumericHistory's charts; never a chart on two scales: one slider stands on one
   *  axis). */
  filter?: ChartFilter;
  /** The chart, larger, in a window of its own (owner, 2026-10-29: "a graceful icon at the top right of the mini-chart …
   *  on the same line as the Y-axis unit"): its button at the right of the unit line; none in the larger one. */
  onExpand?: () => void;
}) {
  const H = height, BOT = height - 12;
  const plot = { left: 0, right: W, top: TOP, bottom: BOT };
  // A line with no readings still has its outage, and its band says so
  // (every line is kept); whether there is anything to draw is lineChart's.
  // from 0 unless this tablet fitted its charts (a tap on any y-axis or its fit mark, owner 2026-10-26)
  const fit = useChartFit();
  // one slider stands on one axis: never on a chart of two lines
  const slid = filter && lines.length === 1 ? filter : null;
  // filtered, the axis holds the values unfiltered and filtered, and the range's limits (chartGeometry)
  const on = slid ? activeRange(slid.range) : null;
  const kept = on && slid?.state === "ready" ? slid.kept ?? null : null;
  // nothing in range: the frame is drawn on the values unfiltered (the axis, and the slider to widen it), no line
  const nothing = kept?.count === 0;
  const w = drawableWindow(window, ...(nothing ? [slid!.base] : lines.map((l) => l.pts)));
  const g = w ? chartGeometry(w, lines.map((l, i) => ({ pts: nothing ? slid!.base : l.pts, gaps: l.gaps ?? [], scale: l.scale ?? "shared", unit: l.unit,
    ...(i === 0 && on ? { holds: slid!.base.map((p) => p.v), limits: on } : {}) })), plot, 0.08, fit) : null;
  const { frac, handlers } = useChartPointer<SVGSVGElement>();
  const hatch = `range-hatch-${useId().replace(/[^\w-]/g, "")}`;
  if (!g) return <><ChartEmpty status={status} height={height} /><TimeAxis g={null} /></>;

  const leftAxis: readonly AxisTick[] = g.series[0].ticks;
  const ownAt = lines.findIndex((l, i) => i > 0 && (l.scale ?? "shared") !== "shared");
  const right = ownAt > 0 ? lines[ownAt] : null;
  const hover = frac !== null && !nothing ? g.hover(g.tAt(frac * W)) : null;
  // the dates and the tooltip of a closed-up chart: its kept steps' real times, worded for the whole period
  const realAt = kept && !nothing ? kept.realAt : (t: number) => t;
  const dated = kept && !nothing ? { ...g, ticks: kept.ticks, spanHours: kept.spanHours } : g;
  const style = (l: LineSpec) => (l.color ? { stroke: l.color } : undefined);
  const ax = g.series[0];
  const unit = lines[0].unit ?? "";
  return (
    <>
      <ChartUnitLine slider={!!slid} left={{ unit: unit.trim(), cls: lines[0].cls?.split(" ")[0], color: lines[0].color }}
        right={right ? { unit: right.unit?.trim() || right.label, cls: right.cls?.split(" ")[0], color: right.color } : null}
        action={onExpand && (
          <button type="button" className="chart-expand" onClick={onExpand} title="Enlarge the chart"
            aria-label={`Enlarge: ${label}`}>
            <Maximize2 size={14} aria-hidden="true" />
          </button>
        )}>
        {on && slid && <RangeChip range={on} step={ax.step} unit={unit} state={slid.state}
          kept={kept ? keptWords(kept.count, kept.of, stepMs) : undefined} onClear={() => slid.onChange(null)} />}
      </ChartUnitLine>
      <div className="chart-with-axis">
        {slid && <ChartRangeSlider axis={ax} top={TOP} bottom={BOT} height={H} range={on} unit={unit}
          onChange={(r) => slid.onChange(activeRange(r))} />}
        <YAxis zoomable height={H} frame={H} ticks={leftAxis} cls={lines[0].cls?.split(" ")[0]} color={lines[0].color} />
        <div className="spark-wrap weather-chart-wrap">
          <svg className="weather-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}
            style={{ height: H, touchAction: "none" }} {...handlers}>
            <g className="chart-grid">{leftAxis.map((t) => <line key={t.v} x1="0" y1={t.y} x2={W} y2={t.y} />)}</g>
            {/* A band per line, in its own slice of the plot: which sensor was
                out is part of the fact. Before the lines — SVG paints in order. */}
            {g.series.flatMap((s, i) => s.bands.map((b, j) => (
              <rect key={`gap${i}-${j}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.gap.notKept ? NOT_KEPT_COLOR : STATUS_COLOR.unavailable} opacity={b.gap.notKept ? 0.5 : 0.18} />
            )))}
            {!nothing && g.series.map((sg, i) => {
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
            {/* What the range leaves out, hatched OVER the grid and the line: above its top and below its bottom. */}
            {on && (
              <g className="chart-range-out">
                <defs>
                  <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" className="chart-range-hatch-bg" />
                    <line x1="0" y1="0" x2="0" y2="6" className="chart-range-hatch" />
                  </pattern>
                </defs>
                {/* only a side the range limits: no limit (±Infinity) is drawn at the axis' end, an empty band */}
                {[[TOP, ax.sy(on.hi)], [ax.sy(on.lo), BOT]].filter(([a, b]) => b > a).map(([a, b]) => (
                  <rect key={a} x="0" y={a} width={W} height={b - a} fill={`url(#${hatch})`} />
                ))}
              </g>
            )}
            {hover && <line x1={hover.x} y1={TOP} x2={hover.x} y2={BOT} className="spark-crosshair" vectorEffect="non-scaling-stroke" />}
          </svg>
          {hover && (
            <ChartTip x={hover.x / W} y={TOP / H} stamp={fmtStepStamp(realAt(hover.t), stepMs, dated.spanHours)}
              rows={lines.flatMap((l, i) => {
                const r = hover.readings[i], out = hover.outages[i];
                const who = lines.length > 1 ? `${l.label} ` : "";
                // An outage under the pointer says so — its span and length.
                if (out) return [{ key: `${i}`, marker: keyOf(l), text: `${who}${fmtOutage(out, g.window.to)}` }];
                // A reading reads as the badge says it ("6.6 kW", not "6571W", 2.496.252):
                // formatUnitValue is the one rule; a unitless line keeps the chart's number.
                if (!r) return [];
                const value = l.unit?.trim() ? formatUnitValue(r.v, l.unit.trim()) : fmtChartValue(r.v);
                return [{ key: `${i}`, marker: keyOf(l), text: `${who}${value}` }];
              })} />
          )}
          {/* Where the kept steps were in the period, in the strip under the plot the chart already has (H - BOT). */}
          {kept && !nothing && (
            <div className="chart-range-ribbon" style={{ bottom: (H - BOT) / 2 - 2 }} aria-hidden>
              {kept.ribbon.map((r) => <i key={r.from} style={{ left: `${r.from * 100}%`, width: `${(r.to - r.from) * 100}%` }} />)}
            </div>
          )}
          {nothing && <div className="chart-range-none">Nothing in {rangeWords(on!, ax.step, unit)}. Widen the range, or tap the chip to show all.</div>}
        </div>
        {/* The right axis is the colour of the line it measures. */}
        {right && <YAxis zoomable side="right" height={H} frame={H} ticks={g.series[ownAt].ticks}
          cls={right.cls?.split(" ")[0]} color={right.color} />}
      </div>
      <TimeAxis g={dated} right={!!right} slider={!!slid} />
    </>
  );
}
