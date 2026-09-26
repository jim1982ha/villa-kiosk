// src/components/panels/ChartTip.tsx
// The app's chart tooltip — one row a series, then the one stamp for all of
// them (utils/chartGeometry's hover answer). Every history chart draws this;
// three hand-drawn copies of it are what let their stamps drift apart.

import type { ReactNode } from "react";
import { fmtChartStamp } from "./chartUtils";

export interface ChartTipRow { key: string; text: string; marker?: ReactNode }

/** `left` is where the crosshair is (px, or a CSS length); past the middle
 *  of the plot the tip hangs to the left of it, so it never leaves the chart. */
export default function ChartTip({ left, top, flip, rows, t, spanHours, stampPrefix = "", stamp }: {
  left: number | string; top: number | string; flip: boolean; rows: ChartTipRow[];
  t: number; spanHours: number; stampPrefix?: string;
  /** A stamp worded by the chart itself (a bucket: "Friday 25 Sep"). */
  stamp?: string;
}) {
  return (
    <div className="spark-tip chart-tip" style={{ left, top, transform: `translateX(${flip ? "-100%" : "0"})` }}>
      {rows.map((r) => <strong key={r.key}>{r.marker}{r.text}</strong>)}
      <span className="spark-tip-time">{stamp ?? `${stampPrefix}${fmtChartStamp(t, spanHours)}`}</span>
    </div>
  );
}
