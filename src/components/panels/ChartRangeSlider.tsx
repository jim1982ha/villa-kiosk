// src/components/panels/ChartRangeSlider.tsx
// The range filter's slider and its chip, LineChart's own (owner, 2026-10-26).
//
// The slider: two handles standing beside the chart's left axis, exactly the plot's height and ON that axis, so a
// handle at a value sits level with that value's tick, whichever way the axis is fitted. VESTA's range look standing
// up and slim (the chart keeps its width): a 4px track, the kept part in the accent, two accent thumbs ringed in the
// window's colour. A handle goes anywhere on the axis; at its own end it is no limit on that side. Touch, mouse, keys.
//
// The chip: what is kept ("273–514 W", "≥ 220 W"), on the line that already holds the unit above the chart
// (ChartAxis.ChartUnitLine), so the window never changes height when a range is set; a tap on it shows all again.
//
// Every decision (where a pointer lands, which handle it takes, a key's step, never crossing) is utils/rangeFilter's,
// pure; this only draws and listens.

import { useRef } from "react";
import { AlertTriangle, Filter, X } from "lucide-react";
import { fmtAxis } from "@/utils/chartGeometry";
import {
  handleGrain, handleValues, keyMove, moveHandle, nearerHandle, valueAtY, type SliderAxis, type ValueRange,
} from "@/utils/rangeFilter";

/** A limit as the chip says it: to the axis' grain, in whole digits of it (a 2.5 grain reads whole numbers). */
export function fmtLimit(v: number, step: number): string {
  return fmtAxis(v, 10 ** Math.floor(Math.log10(handleGrain(step))));
}

/** "273–514 W", "≥ 220 W", "≤ -75 dBm"; with a negative limit "-86 to -75 dBm" (never "-86–-75"). `unit` comes with
 *  its leading space. */
export function rangeWords(r: ValueRange, step: number, unit: string): string {
  const lo = fmtLimit(r.lo, step), hi = fmtLimit(r.hi, step);
  if (!Number.isFinite(r.hi)) return `≥ ${lo}${unit}`;
  if (!Number.isFinite(r.lo)) return `≤ ${hi}${unit}`;
  return `${lo}${r.lo < 0 || r.hi < 0 ? " to " : "–"}${hi}${unit}`;
}

/** The chip: what is kept; a tap shows everything. While the detail loads it is dimmed (the chart is drawn in full
 *  meanwhile); when it could not be read, a warning sign replaces the filter's and the chart is in full. */
export function RangeChip({ range, step, unit, state, onClear }: {
  range: ValueRange; step: number; unit: string; state: "ready" | "loading" | "failed"; onClear: () => void;
}) {
  const words = rangeWords(range, step, unit);
  const note = state === "loading" ? ", loading the detail" : state === "failed" ? ", couldn't load the detail: shown in full" : "";
  return (
    <button type="button" className={`chart-range-chip${state === "ready" ? "" : ` ${state}`}`} onClick={onClear}
      aria-busy={state === "loading" || undefined} aria-label={`Only ${words}${note}. Tap to show all`} title="Show all">
      {state === "failed" ? <AlertTriangle size={11} aria-hidden /> : <Filter size={11} aria-hidden />}
      <span className="chart-range-chip-words">{words}</span>
      <span className="chart-range-chip-x" aria-hidden><X size={10} strokeWidth={3} /></span>
    </button>
  );
}

export default function ChartRangeSlider({ axis, top, bottom, height, range, unit, onChange }: {
  /** The chart's left axis (chartGeometry series[0]). */
  axis: SliderAxis & { sy: (v: number) => number };
  /** The plot's top and bottom, in the drawing's px (the SVG's own). */
  top: number;
  bottom: number;
  height: number;
  /** The range set (±Infinity, or null: no limit). */
  range: ValueRange | null;
  /** The reading's unit, for a screen reader. */
  unit: string;
  onChange: (r: ValueRange) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef<"lo" | "hi" | null>(null);
  const at = handleValues(range, axis);
  const yHi = axis.sy(at.hi), yLo = axis.sy(at.lo);
  const valueAt = (clientY: number) => {
    const r = rail.current!.getBoundingClientRect();
    return valueAtY(axis, { top, bottom }, ((clientY - r.top) * height) / (r.height || height));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = valueAt(e.clientY);
    const on = (e.target as HTMLElement).dataset?.k;
    drag.current = on === "lo" || on === "hi" ? on : nearerHandle(range, v, axis);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    onChange(moveHandle(range, drag.current, v, axis));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) onChange(moveHandle(range, drag.current, valueAt(e.clientY), axis));
  };
  const end = () => { drag.current = null; };
  const limited = (k: "lo" | "hi") => range !== null && Number.isFinite(range[k]);
  const thumb = (k: "lo" | "hi", y: number) => (
    <div className="chart-range-thumb" data-k={k} style={{ top: y }} role="slider" tabIndex={0}
      aria-label={k === "hi" ? "Highest value kept" : "Lowest value kept"} aria-orientation="vertical"
      aria-valuemin={axis.lo} aria-valuemax={axis.hi} aria-valuenow={at[k]}
      aria-valuetext={limited(k) ? `${fmtLimit(at[k], axis.step)}${unit}` : k === "hi" ? "No upper limit" : "No lower limit"}
      onKeyDown={(e) => {
        const r = keyMove(range, k, e.key, axis);
        if (r) { e.preventDefault(); onChange(r); }
      }} />
  );
  return (
    <div className="chart-range" ref={rail} style={{ height }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}>
      <div className="chart-range-track" style={{ top, height: bottom - top }} />
      <div className="chart-range-kept" style={{ top: yHi, height: Math.max(0, yLo - yHi) }} />
      {thumb("hi", yHi)}
      {thumb("lo", yLo)}
    </div>
  );
}
