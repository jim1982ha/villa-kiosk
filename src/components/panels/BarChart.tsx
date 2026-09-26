// src/components/panels/BarChart.tsx
// The app's bucketed bar chart — the Energy window's charts and the Weather
// window's rain. It draws what utils/barChart lays out: the scale and its
// axis, a slot a bucket (a bar, a stub for "nothing yet", or an outage band
// for "no reading"), the typical line, the tooltip and the x labels.

import ChartTip from "./ChartTip";
import YAxis from "./ChartAxis";
import { useChartPointer } from "./useChartPointer";
import { STATUS_COLOR } from "@/utils/stateColors";
import { barLayout, lineLayout, barAt, barCentre, barTick, barTipRows, type BarBucket } from "@/utils/barChart";

/** A second measure plotted over the bars, on its own right-hand axis. */
export interface BarChartLine {
  values: (number | undefined)[];
  label: string;
  /** Its colour (a `.key` class), for the line, its dots and its tooltip row. */
  cls: string;
  unit?: string;
  fmt: (v: number) => string;
}

export default function BarChart({ buckets, fmt, unit, stamp, ticks, typical, height = 150, note, label, line }: {
  buckets: BarBucket[];
  /** A value in the chart's unit, as the tooltip writes it ("1.20 kWh", "Rp 45.000"). */
  fmt: (v: number) => string;
  /** The unit over the y-axis (kWh, IDR, mm). */
  unit?: string;
  /** The tooltip's stamp for a bucket. */
  stamp: (t: number) => string;
  /** x labels, by bucket index. */
  ticks: { i: number; label: string }[];
  /** A typical value, drawn as a dashed line. */
  typical?: number;
  height?: number;
  /** A sentence over the plot ("No rain in the last 24 h"). */
  note?: string;
  label: string;
  /** A second measure over the bars (the cost over the energy). */
  line?: BarChartLine;
}) {
  const n = buckets.length;
  const L = barLayout(buckets, typical);
  const LL = line ? lineLayout(line.values) : null;
  const { frac, handlers } = useChartPointer<HTMLDivElement>();
  const hover = frac === null ? null : barAt(frac, n);
  const hb = hover === null ? null : buckets[hover];
  const rows = hb ? barTipRows(hb, fmt, line && { label: line.label, cls: line.cls, v: line.values[hover!], fmt: line.fmt }) : [];
  return (
    <div className={`chart-with-axis${unit || line?.unit ? " has-unit" : ""}`}>
      <YAxis unit={unit} height={height} frame={1} ticks={L.ticks} />
      <div className="spark-wrap bar-chart-wrap">
        <div className="bar-chart" style={{ height, touchAction: "none" }} role="img" aria-label={label}
          {...handlers}>
          {L.ticks.map((t) => <div key={`g${t.v}`} className="chart-gridline" style={{ bottom: `${(1 - t.y) * 100}%` }} />)}
          {L.bars.map((b, i) => (
            <div key={b.t} className={`bar-slot${hover === i ? " hover" : ""}`}>
              {b.missing
                ? <div className="bar-band" style={{ background: STATUS_COLOR.unavailable }} />
                : (
                  <div className="bar-stack">
                    {b.segs.length === 0
                      ? <div className="bar-seg none" />
                      : b.segs.every((s) => s.h === 0)
                        // A reading of 0 (a dry hour) is still a reading: a
                        // hairline in its colour, not the empty "nothing yet".
                        ? <div className={`bar-seg zero ${b.segs[0].cls}`} />
                        : b.segs.map((s) => <div key={s.key} className={`bar-seg ${s.cls}`} style={{ height: `${s.h * 100}%` }} />)}
                  </div>
                )}
            </div>
          ))}
          {L.typicalAt !== undefined && <div className="bar-chart-typical" style={{ bottom: `${L.typicalAt * 100}%` }} />}
          {LL && (
            // The plotted measure: a line through each bucket's centre, broken
            // where it has no value, and a dot on each point.
            <>
              <svg className={`bar-chart-line ${line!.cls}`} viewBox={`0 0 ${n} 1`} preserveAspectRatio="none" aria-hidden="true">
                {LL.runs.map((r, k) => (
                  <polyline key={k} points={r.map((p) => `${p.i + 0.5},${p.y}`).join(" ")} vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
              {LL.runs.flat().map((p) => (
                <i key={`d${p.i}`} className={`bar-chart-dot ${line!.cls}${hover === p.i ? " hover" : ""}`}
                  style={{ left: `${barCentre(p.i, n) * 100}%`, top: `${p.y * 100}%` }} />
              ))}
            </>
          )}
          {note && <div className="bar-chart-note">{note}</div>}
        </div>
        {hb && rows.length > 0 && (
          <ChartTip x={barCentre(hover!, n)} y={0} stamp={stamp(hb.t)}
            rows={rows.map((r) => ({ key: r.key, marker: r.cls ? <i className={`key ${r.cls}`} /> : undefined, text: r.text }))} />
        )}
        <div className="bar-chart-axis">
          {ticks.map(({ i, label: l }) => {
            const p = barTick(i, n);
            return <span key={`${i}${l}`} className={p.align} style={{ left: `${p.at * 100}%` }}>{l}</span>;
          })}
        </div>
      </div>
      {LL && <YAxis side="right" unit={line!.unit} height={height} frame={1} ticks={LL.ticks} />}
    </div>
  );
}
