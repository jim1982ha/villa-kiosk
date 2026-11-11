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
//
// ⚠️ AN ICON CAN BE ITS BUTTON (owner, 2026-11-06: "each card shows the specific icon's tooltip"): `trigger` draws a
// card's source icon in place of the (i) (sourceIcons IconTip), the same card, placement, closing and hover grace.
// ⚠️ ...OR A BUTTON OF ITS PLACE (`button`: the class of a window header's, "btn icon-only"): the Cockpit's updates
// count said which updates on hover only; a tap now opens the same card (UI scan, 2026-11-10).
// ⚠️ A PRESS ON IT IS ITS OWN: its button and its card (a portal is inside it in React's tree) stop the press, the
// tap and the hold's keys from reaching what holds them — a card's tap opens it, its hold erases it (RecordCard,
// ErasableRow) — as a card's bar does (ActionsRow). Outside-close and Escape listen before anything (useOutsideClose).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useOutsideClose } from "@/hooks/useOutsideClose";
import IconButton from "./IconButton";
import { infoTipPlacement, INFO_TIP_WIDTH } from "./infoTipPlacement";

/** How long the pointer may be between the (i) and its card before a hover-opened card closes. */
const HOVER_GRACE_MS = 150;

/** A press inside the (i) or its card stays there (see above); Enter and Space are a hold's keys (useLongPress). */
export const KEEP_PRESS = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); },
};

export default function InfoTip({ label, children, className, width = INFO_TIP_WIDTH, trigger, button = "info-trigger" }: {
  /** What the button is for, read by a screen reader ("How this list is kept up to date"). */
  label: string;
  /** What the button shows in place of the (i): a card's source icon (sourceIcons IconTip). */
  trigger?: ReactNode;
  /** With `trigger`: its button's look where it is one of its place's buttons, the bare icon unless said. */
  button?: string;
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

  const press = () => setOpen((v) => hovering.current || !v);

  return (
    <span ref={ref} className={`info-tip${open ? " open" : ""}${className ? ` ${className}` : ""}`}
      onPointerEnter={hoverIn} onPointerLeave={hoverOut} {...KEEP_PRESS}>
      {/* the app's lone icon button, its card in place of a tip; a card's own icon (`trigger`) stays that icon */}
      {trigger
        ? <button type="button" className={button} aria-label={label} aria-expanded={open} onClick={press}>{trigger}</button>
        : <IconButton small label={label} tip={null} aria-expanded={open} onClick={press}><Info size={16} /></IconButton>}
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
export function TipTitle({ title, after, tip }: {
  title: ReactNode;
  /** Between the title and its (i): the section's counts that show its lists (Devices, FoldedList.SectionViewButtons). */
  after?: ReactNode;
  tip?: ReactNode;
}) {
  const info = <InfoTip label={`About ${typeof title === "string" ? title : "this section"}`}>{tip}</InfoTip>;
  return (
    <div className={`settings-section-title${tip ? " with-tip" : ""}`}>
      {title}
      {/* the counts and the (i) one unit: on a narrow screen they go under the title together, never the (i) alone */}
      {after ? <span className="title-after">{after}{tip && info}</span> : tip && info}
    </div>
  );
}
