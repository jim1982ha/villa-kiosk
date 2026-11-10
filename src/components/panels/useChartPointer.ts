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
  const off = () => setFrac(null);
  return {
    frac,
    // ⚠️ THE CHART TAKES THE TOUCH ALONG ITS OWN AXIS ONLY (UI scan, 2026-11-10): it took all of it ("none"), so on a
    // phone a window that is mostly chart (Weather, Energy) could not be scrolled with a thumb that landed on one.
    // Across the chart reads it; the other way scrolls the window, and the browser's cancel takes the reading away.
    touchAction: axis === "x" ? "pan-y" : "pan-x",
    handlers: { onPointerMove: on, onPointerDown: on, onPointerLeave: off, onPointerCancel: off },
  } as const;
}
