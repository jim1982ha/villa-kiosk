// src/components/panels/chartFrame.tsx
// The device window's chart, as the bands under it must line up with it (owner, 2026-11-14: a pump's power chart
// started right of its axis numbers and slider while its linked relay's bar ran the window's full width, so one time
// sat at two places). The window's chart (LineChart `frame`) says which columns stand beside its plot — the range
// slider, the left axis, a right axis — and the time it spans; a linked band (LinkedSensorRow) draws the same columns,
// empty, with the same classes, so its bar starts and ends exactly where the plot does, over the same time.
// No chart (a camera's bars, a lock's): the bands keep the window's full width, as they always did.

import { createContext, useContext, useState, type ReactNode } from "react";

export interface ChartFrame {
  /** The range slider's column, left of the axis numbers. */
  slider: boolean;
  /** A right-hand axis (a chart of two lines on two scales). */
  right: boolean;
  /** The time the plot spans, epoch ms; null when its steps are closed up (a range filter keeps some only), so its x
   *  is no longer time and nothing can line up with it. */
  window: { from: number; to: number } | null;
}

type Slot = [ChartFrame | null, (f: ChartFrame | null) => void];
const Frame = createContext<Slot | null>(null);

/** The window's one chart frame, set by its chart, read by its bands. */
export function ChartFrameShare({ children }: { children: ReactNode }) {
  const slot = useState<ChartFrame | null>(null);
  return <Frame.Provider value={slot}>{children}</Frame.Provider>;
}

/** The window's chart frame, or null (no chart, or outside a device window). */
export function useChartFrame(): ChartFrame | null {
  return useContext(Frame)?.[0] ?? null;
}

/** The setter a chart publishes its frame with; null outside a device window. */
export function useChartFrameSetter(): ((f: ChartFrame | null) => void) | null {
  return useContext(Frame)?.[1] ?? null;
}

/** `band` with the chart's columns beside it, empty: its bar under the plot exactly. Without a frame, as is. */
export function AlignedToChart({ frame, children }: { frame: ChartFrame | null; children: ReactNode }) {
  if (!frame) return <>{children}</>;
  return (
    <div className="chart-with-axis chart-aligned">
      {frame.slider && <span className="chart-range chart-gutter" aria-hidden />}
      <span className="chart-yaxis left chart-gutter" aria-hidden />
      <div className="chart-aligned-band">{children}</div>
      {frame.right && <span className="chart-yaxis right chart-gutter" aria-hidden />}
    </div>
  );
}
