// src/components/common/Tip.tsx
// The app's hover tooltip for anything that is not a chart: the same card as a chart's (.spark-tip, ChartTip), drawn
// into <body> at a fixed position and placed by the same rule (chartHover.placeTip) — under what is hovered, above it
// when there is no room below, never past the screen's edge.
//
// ⚠️ NOT THE BROWSER'S `title` (owner, 2026-10-22: "check the tooltips in the whole Cockpit are consistently styled
// with other tooltips in the Kiosk"): the Cockpit's hover texts were the browser's own grey box, the charts' and the
// map's the Kiosk's card. A touchscreen has no hover: the text is the element's accessible name there (aria-label is
// the caller's, as for any icon button).
//
// ⚠️ ONE DRAWING PLACE, ONE MARK (owner, 2026-11-10: "only 1 definition for all similar UI elements"): the Cockpit had
// this card, seventy other elements (the top bar, the camera, the device windows, Settings) still the browser's grey
// `title`, and each <Tip> carried its own listeners and its own card. An element now only SAYS its text (`data-tip`,
// written directly or by <Tip>); the one TipLayer at the app's root hears every pointer and draws the one card. A
// native `title` on an element is never written again.

import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { placeTip } from "@/utils/chartHover";

/** The gap (px) between what is hovered and its tip. */
const TIP_GAP_PX = 6;

/** Marks ONE element with its hover text; `text` empty: no tip. */
export default function Tip({ text, children }: { text?: string | null; children: ReactElement }) {
  return text ? cloneElement(children as ReactElement<{ "data-tip"?: string }>, { "data-tip": text }) : children;
}

type Shown = { host: Element; text: string };

/** The app's one tooltip, mounted once (App): under a mouse and under the keyboard's focus, never under a finger. */
export function TipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const show = (target: EventTarget | null) => {
      const host = target instanceof Element ? target.closest("[data-tip]") : null;
      let text = host?.getAttribute("data-tip");
      // a text marked with itself (a title, a name that may be cut): its tip only when it IS cut
      if (host && text === host.textContent?.trim() && host.scrollWidth <= host.clientWidth && host.scrollHeight <= host.clientHeight) text = null;
      setShown((s) => (host && text ? (s && s.host === host && s.text === text ? s : { host, text }) : null));
    };
    const hide = () => setShown(null);
    const over = (e: PointerEvent) => { if (e.pointerType === "mouse") show(e.target); };
    // where the pointer goes: off the page, or onto a disabled button, which hears no pointer of its own
    const out = (e: PointerEvent) => { if (e.pointerType === "mouse") show(e.relatedTarget); };
    // a press focuses too: only the keyboard's focus shows a tip
    const focus = (e: FocusEvent) => { if (e.target instanceof Element && e.target.matches(":focus-visible")) show(e.target); };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    // a press, a key or a scroll answers the element: its tip is in the way
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);

  // what is hovered left the page, or says something else now (a notice that ends, a state that changes under the mouse)
  useEffect(() => {
    if (!shown) return;
    const check = () => {
      const text = shown.host.isConnected ? shown.host.getAttribute("data-tip") : null;
      if (text !== shown.text) setShown(text ? { host: shown.host, text } : null);
    };
    const seen = new MutationObserver(check);
    seen.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tip"] });
    return () => seen.disconnect();
  }, [shown]);

  useLayoutEffect(() => {
    if (!shown || !tip.current) { setAt(null); return; }
    const r = shown.host.getBoundingClientRect();
    const el = tip.current;
    const below = { x: r.left + r.width / 2 - el.offsetWidth / 2, y: r.bottom + TIP_GAP_PX };
    const p = placeTip(below, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }, false);
    // no room below: above it (placeTip only flips to the anchor's top edge)
    const y = p.y < below.y ? r.top - TIP_GAP_PX - el.offsetHeight : p.y;
    setAt((q) => (q && q.x === p.x && q.y === y ? q : { x: p.x, y }));
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div ref={tip} role="tooltip" className="spark-tip ui-tip"
      style={{ position: "fixed", left: at?.x ?? 0, top: at?.y ?? 0, visibility: at ? "visible" : "hidden" }}>
      {shown.text}
    </div>,
    document.body,
  );
}
