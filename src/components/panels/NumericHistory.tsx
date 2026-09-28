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

import LineChart from "./LineChart";
import { useHistoryRange, HistoryHeader } from "./historyRange";
import { useHistorySource } from "@/hooks/useHistorySource";

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
  const ids = series.map((s) => s.id);
  const { data, status } = useHistorySource(
    ids.length ? { trend: { kind: "trend", ids, hours: range.hours } } : null);
  const history = data?.trend ?? {};
  const line = (s: NumericSeries, extra: { scale?: "own"; dashed?: boolean } = {}) => ({
    pts: history[s.id]?.points ?? [], gaps: history[s.id]?.gaps ?? [], label: s.label,
    unit: s.unit ? ` ${s.unit}` : "", color: s.color, ...extra,
  });

  if (series.length === 0) return null;
  if (series.length === 1 && !named) {
    return (
      <div className="field">
        <HistoryHeader title={range.title} picker={picker} />
        <LineChart label="History" height={110} window={history[series[0].id]?.window} status={status}
          lines={[line(series[0])]} />
      </div>
    );
  }
  if (series.length === 2) {
    const [a, b] = series;
    return (
      <div className="field">
        <HistoryHeader title={range.title} picker={picker} />
        <LineChart label={`${a.label} and ${b.label} history`} height={120}
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
            ? <HistoryHeader title={`${s.label} — ${range.title.toLowerCase()}`} picker={picker} />
            : <label className="entity-label">{s.label} — {range.title.toLowerCase()}</label>}
          <LineChart label={`${s.label} history`} height={110} window={history[s.id]?.window} status={status}
            lines={[line(s)]} />
        </div>
      ))}
    </>
  );
}
