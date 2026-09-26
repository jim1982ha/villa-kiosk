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
import { placeTip, tipFlips } from "@/utils/chartHover";

/** A row: bold by default; `event` rows are the plain lines of a list (a
 *  timeline's detections under their time range). */
export interface ChartTipRow { key: string; text: string; marker?: ReactNode; event?: boolean }

/**
 * `x`, `y` — WHERE, as fractions of the chart's positioned box (0–1 across,
 * 0–1 down): the one convention every chart speaks (utils/chartHover). The
 * tip hangs to the left when that point is past the chart's middle, opens
 * upward when there is no room below, and stays on screen (placeTip).
 * `stamp` — the dim line under the rows, worded by the chart.
 */
export default function ChartTip({ x, y, rows, stamp }: {
  x: number; y: number; rows: ChartTipRow[]; stamp?: string;
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
      const box = (a.offsetParent ?? a.parentElement)?.getBoundingClientRect();
      const flip = box ? tipFlips(r.left, box.left, box.width) : false;
      const p = placeTip({ x: r.left, y: r.top }, { w: el.offsetWidth, h: el.offsetHeight },
        { w: window.innerWidth, h: window.innerHeight }, flip);
      setAt((q) => (q && q.x === p.x && q.y === p.y ? q : p));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  });
  return (
    <>
      <span ref={anchor} className="chart-tip-anchor" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} aria-hidden="true" />
      {createPortal(
        <div ref={tip} className="spark-tip chart-tip"
          style={{ position: "fixed", left: at?.x ?? 0, top: at?.y ?? 0, visibility: at ? "visible" : "hidden" }}>
          {rows.map((r) => r.event
            ? <span key={r.key} className="spark-tip-event">{r.marker}{r.text}</span>
            : <strong key={r.key}>{r.marker}{r.text}</strong>)}
          {stamp && <span className="spark-tip-time">{stamp}</span>}
        </div>,
        document.body,
      )}
    </>
  );
}
