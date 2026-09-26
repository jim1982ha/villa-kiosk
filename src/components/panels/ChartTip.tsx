// src/components/panels/ChartTip.tsx
// The app's chart tooltip — one row a series, then the one stamp for all of
// them (utils/chartGeometry's hover answer). Every history chart draws this;
// three hand-drawn copies of it are what let their stamps drift apart.
//
// ⚠️ It FLOATS ABOVE EVERY LAYER: drawn into <body> at a fixed position, not
// inside the chart. Inside, a tall tip (the energy flow's, with the devices
// inside a meter) grew the window's scroll area — the whole window shifted
// and the tip was cut off at its footer (owner, 2026-09-26). The chart only
// says WHERE (an anchor it positions like before); this places the tip at
// that point on screen, opens it upward when there is no room below, and
// keeps it inside the viewport.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fmtChartStamp } from "./chartUtils";

export interface ChartTipRow { key: string; text: string; marker?: ReactNode }

/** Margin kept between the tip and the viewport's edges, px. */
const EDGE = 8;

/** `left`/`top` are where the crosshair is in the chart (px, or a CSS
 *  length), in the chart's positioned wrapper; with `flip` (past the middle
 *  of the plot) the tip hangs to the left of that point. */
export default function ChartTip({ left, top, flip, rows, t, spanHours, stampPrefix = "", stamp }: {
  left: number | string; top: number | string; flip: boolean; rows: ChartTipRow[];
  t: number; spanHours: number; stampPrefix?: string;
  /** A stamp worded by the chart itself (a bucket: "Friday 25 Sep"). */
  stamp?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // Every render (the hover moves the anchor), and on any scroll or resize
  // while it shows. Settles in one pass: an unchanged place keeps `at`.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current, el = tip.current;
      if (!a || !el) return;
      const r = a.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = flip ? r.left - w : r.left;
      let y = r.top + h > vh - EDGE ? r.top - h : r.top; // no room below: open upward
      x = Math.min(Math.max(EDGE, x), vw - w - EDGE);
      y = Math.min(Math.max(EDGE, y), vh - h - EDGE);
      setAt((p) => (p && p.x === x && p.y === y ? p : { x, y }));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  });
  return (
    <>
      <span ref={anchor} className="chart-tip-anchor" style={{ left, top }} aria-hidden="true" />
      {createPortal(
        <div ref={tip} className="spark-tip chart-tip"
          style={{ position: "fixed", left: at?.x ?? 0, top: at?.y ?? 0, visibility: at ? "visible" : "hidden" }}>
          {rows.map((r) => <strong key={r.key}>{r.marker}{r.text}</strong>)}
          <span className="spark-tip-time">{stamp ?? `${stampPrefix}${fmtChartStamp(t, spanHours)}`}</span>
        </div>,
        document.body,
      )}
    </>
  );
}
