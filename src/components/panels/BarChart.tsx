// src/components/panels/BarChart.tsx
// The app's bucketed bar chart — the Energy window's charts and the Weather
// window's rain. It draws what utils/barChart lays out: the scale and its
// axis, a slot a bucket (a bar, a stub for "nothing yet", or an outage band
// for "no reading"), the typical line, the tooltip and the x labels.

import ChartTip from "./ChartTip";
import YAxis from "./ChartAxis";
import { useChartPointer } from "./useChartPointer";
import { STATUS_COLOR } from "@/utils/stateColors";
import { barLayout, barAt, barCentre, barTick, barTipRows, type BarBucket } from "@/utils/barChart";

export default function BarChart({ buckets, fmt, unit, stamp, ticks, typical, height = 150, note, label }: {
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
}) {
  const n = buckets.length;
  const L = barLayout(buckets, typical);
  const { frac, handlers } = useChartPointer<HTMLDivElement>();
  const hover = frac === null ? null : barAt(frac, n);
  const hb = hover === null ? null : buckets[hover];
  const rows = hb ? barTipRows(hb, fmt) : [];
  return (
    <div className={`chart-with-axis${unit ? " has-unit" : ""}`}>
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
    </div>
  );
}
