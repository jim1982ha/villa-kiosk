// src/components/panels/useChartPointer.ts
// Where the pointer (or the finger) is across a chart, as a fraction 0–1 —
// the one way every chart reads it (utils/chartHover.pointerFraction). Each
// chart turns the fraction into its own answer: a time (chartGeometry.tAt),
// a bucket (barChart.barAt), a timeline cell.

import { useState, type PointerEvent } from "react";
import { pointerFraction } from "@/utils/chartHover";

/** `axis` — the direction the chart runs (a vertical timeline reads y). */
export function useChartPointer<E extends Element>(axis: "x" | "y" = "x") {
  const [frac, setFrac] = useState<number | null>(null);
  const on = (e: PointerEvent<E>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setFrac(axis === "x" ? pointerFraction(e.clientX, r.left, r.width) : pointerFraction(e.clientY, r.top, r.height));
  };
  return { frac, handlers: { onPointerMove: on, onPointerDown: on, onPointerLeave: () => setFrac(null) } };
}
