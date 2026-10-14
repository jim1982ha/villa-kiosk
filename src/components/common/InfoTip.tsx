// src/components/common/InfoTip.tsx
// THE (i) button with its explanation card — one for every (i) in the app (the 3D model's details in Advanced
// Settings, when faults open and close on the Overview).
//
// ⚠️ A TAP OPENS IT, ON EVERY PHONE (2026-10-14). The card opened on :hover, or on :focus-within for a tap — and
// iOS Safari does not focus a <button> it taps, so on an iPhone the (i) did nothing. A tap now toggles it; a tap
// outside it or Escape closes it (useOutsideClose); a mouse still opens it on hover, through the same CSS
// (.info-tip in 04-modals.css), and a keyboard on focus.

import { useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { useOutsideClose } from "@/hooks/useOutsideClose";

export default function InfoTip({ label, children, className }: {
  /** What the button is for, read by a screen reader ("How this list is kept up to date"). */
  label: string;
  children: ReactNode;
  /** Extra class on the wrapper, for the card's anchoring in a given place. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useOutsideClose([ref], open, () => setOpen(false));
  return (
    <span ref={ref} className={`info-tip${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="info-btn" aria-label={label} aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <Info size={16} />
      </button>
      <div className="info-pop" role="tooltip">{children}</div>
    </span>
  );
}
