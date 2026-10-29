// src/components/panels/NumericHistory.tsx
// THE numeric history section of a device panel — LastDayTimeline's twin for
// readings: the shared range header, the trend request, where it stands, and
// the line chart(s). SensorPanel and DeviceGroupPanel each wired range +
// fetch + status + chart by hand, with their own key strings; a chart whose
// window disagreed with its header is what that shape keeps producing.
//
// One series: one chart under the range header. Two: one chart, each on its
// OWN scale (left and right axes in their line's colour), the second dashed —
// a temperature and a humidity never share a y-axis. More (or `named` with
// one): a chart per series, the picker on the first only, because it drives
// ONE shared request — repeating it per chart would imply each had its own
// window.
//
// THE RANGE FILTER (owner, 2026-10-26): the one-line charts (one series, and each chart of the multi-series layout)
// carry LineChart's slider; the chart on two scales does not (one slider stands on one axis). A range is plain state
// here, per series, scoped to the readings shown (rangeFilter.filterScope): kept while the period changes, forgotten
// when the window closes or another reading is opened. Never stored. The finer values are asked only while a range
// leaves something out, over the trend's own window; what each chart then draws is rangeFilter.rangeChart's.

import { useState } from "react";
import LineChart, { type ChartFilter } from "./LineChart";
import { useHistoryRange, HistoryHeader, ChartStep } from "./historyRange";
import ChartWindow, { chartWindowHeight } from "./ChartWindow";
import { aggregationWords } from "./chartUtils";
import { useHistorySource } from "@/hooks/useHistorySource";
import type { TimeWindow } from "@/utils/lineChart";
import {
  activeRange, filterOf, filterScope, rangeChart, NO_FILTERS, withFilter, type FilterState,
} from "@/utils/rangeFilter";

export interface NumericSeries {
  id: string;
  label: string;
  /** The reading's unit, without a leading space. */
  unit: string;
  color: string;
}

export default function NumericHistory({ series, named = false, name }: {
  series: readonly NumericSeries[];
  /** Title each chart with its series' label, even when there is one. */
  named?: boolean;
  /** The device's name: the larger chart's window is titled with it (one series, or two on one chart). */
  name?: string;
}) {
  const { range, picker } = useHistoryRange();
  // a device's measured value: the mean over the range's step (historySource "trend")
  const step = aggregationWords(range.grainMs, "avg");
  const ids = series.map((s) => s.id);
  const { data, status } = useHistorySource(
    ids.length ? { trend: { kind: "trend", ids, hours: range.hours, period: range.period } } : null);
  const history = data?.trend ?? {};
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
  const scope = filterScope(series);
  // two series share one chart, each on its own scale; every other layout is a chart per series
  const dual = series.length === 2;
  // the charts with a slider: every one but the chart on two scales
  const slidable = dual ? [] : series;
  const filtering = slidable.filter((s) => activeRange(filterOf(filters, scope, s.id)));
  // their detail, over the trend's own window (one clock): only once the trend is in
  const over = history[filtering[0]?.id]?.window;
  const { data: finer, status: finerStatus } = useHistorySource(filtering.length && over
    ? { finer: { kind: "finer", ids: filtering.map((s) => s.id), window: over, period: range.period } } : null);
  const line = (s: NumericSeries, extra: { scale?: "own"; dashed?: boolean } = {}) => ({
    pts: history[s.id]?.points ?? [], gaps: history[s.id]?.gaps ?? [], label: s.label,
    unit: s.unit ? ` ${s.unit}` : "", color: s.color, ...extra,
  });
  /** A one-line chart's line, window and filter (rangeFilter.rangeChart). */
  const filtered = (s: NumericSeries): { lines: ReturnType<typeof line>[]; window?: TimeWindow; filter: ChartFilter } => {
    const base = history[s.id], set = filterOf(filters, scope, s.id);
    const c = rangeChart(base, set, range.period, range.grainMs, { finer: finer?.finer?.[s.id], failed: finerStatus === "failed" });
    return {
      lines: [{ ...line(s), pts: c.points, gaps: c.gaps }],
      window: c.window,
      filter: {
        base: base?.points ?? [], range: set, kept: c.kept, state: c.state,
        onChange: (r) => setFilters((st) => withFilter(st, scope, s.id, r)),
      },
    };
  };

  // ⚠️ THE CHART, LARGER (owner, 2026-10-29): the same chart — its header, period toggle and range slider, bound to the
  // same choices — redrawn in a window of its own (ChartWindow), opened from its unit line; one at a time
  const [big, setBig] = useState<string | null>(null);
  const tall = big ? chartWindowHeight(globalThis.innerHeight ?? 800) : 0;
  const expand = (key: string) => () => setBig(key);
  const header = (title: string) => <HistoryHeader title={title} picker={picker} step={step} />;

  if (series.length === 0) return null;
  if (series.length === 1 && !named) {
    const f = filtered(series[0]);
    const chart = (height: number, onExpand?: () => void) => (
      <LineChart stepMs={range.grainMs} label="History" height={height} status={status} window={f.window} lines={f.lines}
        filter={f.filter} onExpand={onExpand} />
    );
    return (
      <div className="field">
        {header(range.title)}
        {chart(110, expand(series[0].id))}
        {big && <ChartWindow title={name ?? series[0].label} onClose={() => setBig(null)}>{header(range.title)}{chart(tall)}</ChartWindow>}
      </div>
    );
  }
  if (dual) {
    const [a, b] = series;
    const chart = (height: number, onExpand?: () => void) => (
      <>
        <LineChart stepMs={range.grainMs} label={`${a.label} and ${b.label} history`} height={height}
          window={history[a.id]?.window} status={status}
          lines={[line(a, { scale: "own" }), line(b, { dashed: true, scale: "own" })]} onExpand={onExpand} />
        <div className="row" style={{ gap: 16, marginTop: 8, fontSize: "var(--text-xs)" }}>
          <span className="muted"><span style={{ color: a.color }}>●</span> {a.label}</span>
          <span className="muted"><span style={{ color: b.color }}>┄</span> {b.label}</span>
        </div>
      </>
    );
    return (
      <div className="field">
        {header(range.title)}
        {chart(120, expand("dual"))}
        {big && <ChartWindow title={name ?? `${a.label} and ${b.label}`} onClose={() => setBig(null)}>
          {header(range.title)}{chart(tall)}</ChartWindow>}
      </div>
    );
  }
  const opened = series.find((s) => s.id === big);
  const chartOf = (s: NumericSeries, height: number, onExpand?: () => void) => {
    const f = filtered(s);
    return <LineChart stepMs={range.grainMs} label={`${s.label} history`} height={height} status={status} window={f.window}
      lines={f.lines} filter={f.filter} onExpand={onExpand} />;
  };
  return (
    <>
      {series.map((s, i) => (
        <div className="field" key={s.id}>
          {i === 0
            ? header(`${s.label}, ${range.title.toLowerCase()}`)
            : <label className="entity-label">{s.label}, {range.title.toLowerCase()}<ChartStep words={step} /></label>}
          {chartOf(s, 110, expand(s.id))}
        </div>
      ))}
      {/* the larger one carries the toggle whichever chart it is: it changes them all, as the first one's does */}
      {opened && <ChartWindow title={opened.label} onClose={() => setBig(null)}>
        {header(`${opened.label}, ${range.title.toLowerCase()}`)}{chartOf(opened, tall)}</ChartWindow>}
    </>
  );
}
