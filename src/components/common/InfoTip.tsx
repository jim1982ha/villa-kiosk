// src/components/common/InfoTip.tsx
// THE (i) button with its explanation card — one for every (i) in the app (the 3D model's details in Advanced
// Settings, when faults open and close, above Open issues).
//
// ⚠️ A TAP OPENS IT, ON EVERY PHONE (2026-10-14). The card opened on :hover, or on :focus-within for a tap — and
// iOS Safari does not focus a <button> it taps, so on an iPhone the (i) did nothing. A tap toggles it; a tap outside
// it or Escape closes it (useOutsideClose); a mouse opens it on hover.
//
// ⚠️ THE CARD IS PORTALLED TO <body> AND PLACED `fixed` (owner, 2026-10-14: the Overview's card was cut off at its
// last line). It lived inside the (i), absolute, capped at 420 px and scrolling inside itself: the Overview's table
// did not fit, its note stopped mid-sentence, and a window's scrolling body could clip it. Now it is measured and
// placed on the screen (infoTipPlacement), as tall as it needs, the Dropdown's way.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useOutsideClose } from "@/hooks/useOutsideClose";
import { infoTipPlacement, INFO_TIP_WIDTH } from "./infoTipPlacement";

/** How long the pointer may be between the (i) and its card before a hover-opened card closes. */
const HOVER_GRACE_MS = 150;

export default function InfoTip({ label, children, className, width = INFO_TIP_WIDTH }: {
  /** What the button is for, read by a screen reader ("How this list is kept up to date"). */
  label: string;
  children: ReactNode;
  /** Extra class on the wrapper. */
  className?: string;
  /** Its card's width when the screen has room, in px (a table of several columns asks for more: FaultTiming). */
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = useRef(false);
  useOutsideClose([ref, pop], open, () => setOpen(false));

  const place = useCallback(() => {
    const b = ref.current?.getBoundingClientRect();
    if (!b) return;
    const p = infoTipPlacement(b, { width: window.innerWidth, height: window.innerHeight }, pop.current?.scrollHeight ?? 0, width);
    setPos({ left: p.left, width: p.width, maxHeight: p.maxHeight, ...(p.above ? { bottom: p.bottom } : { top: p.top }) });
  }, [width]);
  // placed once drawn (its height decides above or below), and again when the screen changes under it
  useLayoutEffect(() => { if (open) place(); else setPos(null); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, place]);
  useEffect(() => () => { if (leave.current) clearTimeout(leave.current); }, []);

  // a MOUSE opens it on hover and closes it when it leaves both the (i) and the card; a touch is a tap
  const hoverIn = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (leave.current) { clearTimeout(leave.current); leave.current = null; }
    hovering.current = true;
    setOpen(true);
  };
  const hoverOut = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    hovering.current = false;
    leave.current = setTimeout(() => setOpen(false), HOVER_GRACE_MS);
  };

  return (
    <span ref={ref} className={`info-tip${open ? " open" : ""}${className ? ` ${className}` : ""}`}
      onPointerEnter={hoverIn} onPointerLeave={hoverOut}>
      <button type="button" className="info-btn" aria-label={label} aria-expanded={open}
        onClick={() => setOpen((v) => hovering.current || !v)}>
        <Info size={16} />
      </button>
      {open && createPortal(
        <div ref={pop} className="info-pop" role="tooltip" style={pos ?? { visibility: "hidden", width: `min(${width}px, calc(100vw - 24px))` }}
          onPointerEnter={hoverIn} onPointerLeave={hoverOut}>
          {children}
        </div>,
        document.body,
      )}
    </span>
  );
}

/**
 * A section's title with its ONE (i) beside it (owner, 2026-10-22: no visible description text in Settings, Advanced
 * Settings or the Cockpit — what a section or an option is for is read in its (i), never in a paragraph under it).
 * `tip` absent: the title alone.
 */
export function TipTitle({ title, tip, className = "settings-section-title", style }: {
  title: ReactNode;
  tip?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`${className}${tip ? " with-tip" : ""}`} style={style}>
      {title}
      {tip && <InfoTip label={`About ${typeof title === "string" ? title : "this section"}`}>{tip}</InfoTip>}
    </div>
  );
}
