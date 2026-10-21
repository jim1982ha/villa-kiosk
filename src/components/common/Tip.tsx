// src/components/common/Tip.tsx
// The app's hover tooltip for anything that is not a chart: the same card as a chart's (.spark-tip, ChartTip), drawn
// into <body> at a fixed position and placed by the same rule (chartHover.placeTip) — under what is hovered, above it
// when there is no room below, never past the screen's edge.
//
// ⚠️ NOT THE BROWSER'S `title` (owner, 2026-10-22: "check the tooltips in the whole Cockpit are consistently styled
// with other tooltips in the Kiosk"): the Cockpit's hover texts were the browser's own grey box, the charts' and the
// map's the Kiosk's card. A touchscreen has no hover: the text is the element's accessible name there (aria-label is
// the caller's, as for any icon button).

import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { placeTip } from "@/utils/chartHover";

/** The gap (px) between what is hovered and its tip. */
const TIP_GAP_PX = 6;

type Handler = (e: SyntheticEvent) => void;
type Host = ReactElement<{ onPointerEnter?: Handler; onPointerLeave?: Handler; onFocus?: Handler; onBlur?: Handler }>;

/** Wraps ONE element (its own handlers kept); `text` empty: no tip. */
export default function Tip({ text, children }: { text?: string | null; children: Host }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!host || !tip.current) { setAt(null); return; }
    const r = host.getBoundingClientRect();
    const el = tip.current;
    const below = { x: r.left + r.width / 2 - el.offsetWidth / 2, y: r.bottom + TIP_GAP_PX };
    const p = placeTip(below, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }, false);
    // no room below: above it (placeTip only flips to the anchor's top edge)
    const y = p.y < below.y ? r.top - TIP_GAP_PX - el.offsetHeight : p.y;
    setAt((q) => (q && q.x === p.x && q.y === y ? q : { x: p.x, y }));
  }, [host, text]);
  if (!text) return children;
  const props = children.props;
  const show = (e: SyntheticEvent) => setHost(e.currentTarget as HTMLElement);
  const hide = () => setHost(null);
  return (
    <>
      {cloneElement(children, {
        onPointerEnter: (e: SyntheticEvent) => { props.onPointerEnter?.(e); if ((e.nativeEvent as PointerEvent).pointerType === "mouse") show(e); },
        onPointerLeave: (e: SyntheticEvent) => { props.onPointerLeave?.(e); hide(); },
        onFocus: (e: SyntheticEvent) => { props.onFocus?.(e); show(e); },
        onBlur: (e: SyntheticEvent) => { props.onBlur?.(e); hide(); },
      })}
      {host && createPortal(
        <div ref={tip} role="tooltip" className="spark-tip ui-tip"
          style={{ position: "fixed", left: at?.x ?? 0, top: at?.y ?? 0, visibility: at ? "visible" : "hidden" }}>
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
