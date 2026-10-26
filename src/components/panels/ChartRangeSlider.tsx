// src/components/panels/ChartRangeSlider.tsx
// The range filter's slider, LineChart's own (owner, 2026-10-26): two handles standing beside the chart's left axis,
// as tall as the plot and ON THAT AXIS, so a handle at a value sits level with that value's tick, whichever way the
// axis is drawn (from 0 or zoomed). VESTA's range look standing up: a 4px pill track, the kept part in the accent, two
// accent thumbs ringed in the window's colour, each value in a small pill beside it. Touch, mouse and keys.
//
// Every decision (where a pointer lands, which handle it takes, a key's step, never crossing) is utils/rangeFilter's,
// pure; this only draws and listens.

import { useRef } from "react";
import { fmtAxis } from "@/utils/chartGeometry";
import {
  handleGrain, keyMove, moveHandle, nearerHandle, pillTops, valueAtY, type ValueRange,
} from "@/utils/rangeFilter";

/** How close (px) the two value pills may come before they are pushed apart. */
const PILL_GAP_PX = 16;

/** A value as the slider says it: like the axis, to the handle's grain. */
export function fmtLimit(v: number, step: number): string {
  return fmtAxis(v, handleGrain(step));
}

export default function ChartRangeSlider({ axis, top, bottom, height, shown, ends, unit, onChange }: {
  /** The chart's left axis (chartGeometry series[0]). */
  axis: { lo: number; hi: number; step: number; sy: (v: number) => number };
  /** The plot's top and bottom, in the drawing's px (the SVG's own). */
  top: number;
  bottom: number;
  height: number;
  /** The handles' values. */
  shown: ValueRange;
  /** The lowest and highest value the chart shows unfiltered: each handle reaches its end exactly, never past it. */
  ends: ValueRange | null;
  /** The reading's unit, for a screen reader. */
  unit: string;
  onChange: (r: ValueRange) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef<"lo" | "hi" | null>(null);
  const yHi = axis.sy(shown.hi), yLo = axis.sy(shown.lo);
  const pills = pillTops(yHi, yLo, PILL_GAP_PX);
  const valueAt = (clientY: number) => {
    const r = rail.current!.getBoundingClientRect();
    return valueAtY(axis, { top, bottom }, ((clientY - r.top) * height) / (r.height || height));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = valueAt(e.clientY);
    const on = (e.target as HTMLElement).dataset?.k;
    drag.current = on === "lo" || on === "hi" ? on : nearerHandle(shown, v);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    onChange(moveHandle(shown, drag.current, v, axis, ends));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) onChange(moveHandle(shown, drag.current, valueAt(e.clientY), axis, ends));
  };
  const end = () => { drag.current = null; };
  const thumb = (k: "lo" | "hi", y: number) => (
    <div className="chart-range-thumb" data-k={k} style={{ top: y }} role="slider" tabIndex={0}
      aria-label={k === "hi" ? "Highest value kept" : "Lowest value kept"} aria-orientation="vertical"
      aria-valuemin={k === "hi" ? shown.lo : ends?.lo ?? axis.lo} aria-valuemax={k === "hi" ? ends?.hi ?? axis.hi : shown.hi} aria-valuenow={shown[k]}
      aria-valuetext={`${fmtLimit(shown[k], axis.step)}${unit}`}
      onKeyDown={(e) => {
        const r = keyMove(shown, k, e.key, axis, ends);
        if (r) { e.preventDefault(); onChange(r); }
      }} />
  );
  return (
    <div className="chart-range" ref={rail} style={{ height }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}>
      <div className="chart-range-track" style={{ top, height: bottom - top }} />
      <div className="chart-range-kept" style={{ top: yHi, height: Math.max(0, yLo - yHi) }} />
      <span className="chart-range-pill" style={{ top: pills.hi }}>{fmtLimit(shown.hi, axis.step)}</span>
      <span className="chart-range-pill" style={{ top: pills.lo }}>{fmtLimit(shown.lo, axis.step)}</span>
      {thumb("hi", yHi)}
      {thumb("lo", yLo)}
    </div>
  );
}
