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
// leaves something out.

import { useState } from "react";
import LineChart, { type ChartFilter } from "./LineChart";
import { useHistoryRange, HistoryHeader, ChartStep } from "./historyRange";
import { aggregationWords } from "./chartUtils";
import { useHistorySource } from "@/hooks/useHistorySource";
import {
  activeRange, filterOf, filterScope, filterSeries, NO_FILTERS, withFilter, type FilterState,
} from "@/utils/rangeFilter";

export interface NumericSeries {
  id: string;
  label: string;
  /** The reading's unit, without a leading space. */
  unit: string;
  color: string;
}

export default function NumericHistory({ series, named = false }: {
  series: readonly NumericSeries[];
  /** Title each chart with its series' label, even when there is one. */
  named?: boolean;
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
  const finerIds = filtering.map((s) => s.id);
  const { data: finer, status: finerStatus } = useHistorySource(
    finerIds.length ? { finer: { kind: "finer", ids: finerIds, hours: range.hours, period: range.period } } : null);
  const line = (s: NumericSeries, extra: { scale?: "own"; dashed?: boolean } = {}) => ({
    pts: history[s.id]?.points ?? [], gaps: history[s.id]?.gaps ?? [], label: s.label,
    unit: s.unit ? ` ${s.unit}` : "", color: s.color, ...extra,
  });
  /** A one-line chart's line and its filter: filtered once its finer values (for this period) are in. */
  const filtered = (s: NumericSeries): { lines: ReturnType<typeof line>[]; filter: ChartFilter } => {
    const base = history[s.id];
    const kept = filterOf(filters, scope, s.id);
    const on = base ? activeRange(kept) : null;
    const f = finer?.finer?.[s.id];
    const ready = on && f && f.of === range.period && finerStatus === "ready" && status === "ready";
    const done = ready ? filterSeries(base!, f, range.grainMs, on) : null;
    const l = line(s);
    return {
      lines: [done ? { ...l, pts: done.points } : l],
      filter: {
        base: base?.points ?? [], range: kept,
        onChange: (r) => setFilters((st) => withFilter(st, scope, s.id, r)),
        state: done ? "ready" : finerStatus === "failed" ? "failed" : "loading",
      },
    };
  };

  if (series.length === 0) return null;
  if (series.length === 1 && !named) {
    return (
      <div className="field">
        <HistoryHeader title={range.title} picker={picker} step={step} />
        <LineChart stepMs={range.grainMs} label="History" height={110} window={history[series[0].id]?.window} status={status}
          {...filtered(series[0])} />
      </div>
    );
  }
  if (dual) {
    const [a, b] = series;
    return (
      <div className="field">
        <HistoryHeader title={range.title} picker={picker} step={step} />
        <LineChart stepMs={range.grainMs} label={`${a.label} and ${b.label} history`} height={120}
          window={history[a.id]?.window} status={status}
          lines={[line(a, { scale: "own" }), line(b, { dashed: true, scale: "own" })]} />
        <div className="row" style={{ gap: 16, marginTop: 8, fontSize: "var(--text-xs)" }}>
          <span className="muted"><span style={{ color: a.color }}>●</span> {a.label}</span>
          <span className="muted"><span style={{ color: b.color }}>┄</span> {b.label}</span>
        </div>
      </div>
    );
  }
  return (
    <>
      {series.map((s, i) => (
        <div className="field" key={s.id}>
          {i === 0
            ? <HistoryHeader title={`${s.label}, ${range.title.toLowerCase()}`} picker={picker} step={step} />
            : <label className="entity-label">{s.label}, {range.title.toLowerCase()}<ChartStep words={step} /></label>}
          <LineChart stepMs={range.grainMs} label={`${s.label} history`} height={110} window={history[s.id]?.window} status={status}
            {...filtered(s)} />
        </div>
      ))}
    </>
  );
}
