// src/components/hud/Notice.tsx
// THE notice of the villa view — every message that appears over the villa: the connection lost, a sensor triggered,
// a tap that failed, a floor-plan sync problem, a new version ready. One shape, one place, one set of colours.
//
// ⚠️ FIVE NOTICES, FIVE LOOKS (owner, 2026-10-18: "make sure all the notification appears formatted the same way …
// it shall call the same piece of code"): the connection banner was an amber pill at 60 px, the update banner an
// accent pill hard-placed 48 px under it, the motion notice a grey-bordered panel pill at 64 px over both, a failed
// tap red text in a red ring, the floor-plan sync problem a square red box at the bottom. Each notice now says only
// WHAT it is (`tone`, its words, what a tap does); NoticeStack places them, one column under the top bar.
//
// The tone is a meaning of "Map colours & keys" (utils/stateColors STATUS_COLOR, the legend's own swatches), never a
// colour of the notice's own: contact lost = unavailable (amber), a sensor triggered = active (green), a failure =
// alert (red). `info` — news that is no device's state (a new version, a floor not modelled) — is the VESTA accent.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { STATUS_COLOR } from "@/utils/stateColors";

export type NoticeTone = "active" | "unavailable" | "alert" | "info";

const TONE: Record<NoticeTone, string> = {
  active: STATUS_COLOR.active,
  unavailable: STATUS_COLOR.unavailable,
  alert: STATUS_COLOR.alert,
  info: "var(--accent)",
};

/** The id of the one column every notice of the villa view is drawn into (NoticeStack). */
export const NOTICE_STACK_ID = "vesta-notices";

export interface NoticeProps {
  tone: NoticeTone;
  icon: ReactNode;
  children: ReactNode;
  /** The whole notice is the button (a new version: tap to reload). */
  onTap?: () => void;
  /** A notice that stays until dismissed carries its ✕. */
  onDismiss?: () => void;
  /** "alert" interrupts a screen reader (a failure); "status" waits its turn. */
  role?: "status" | "alert";
  /** Hidden while the fullscreen camera is open: the villa's own news never covers the live picture. */
  belowCamera?: boolean;
}

/** One notice, drawn — pure (a check draws it). */
export function NoticeView({ tone, icon, children, onTap, onDismiss, role = "status", belowCamera }: NoticeProps) {
  const className = `vesta-notice${onTap ? " tappable" : ""}${belowCamera ? " below-camera" : ""}`;
  const style = { "--tone": TONE[tone] } as React.CSSProperties;
  const inner = (
    <>
      {icon}
      <span className="vesta-notice-text">{children}</span>
      {onDismiss && (
        <button type="button" className="vesta-notice-dismiss" onClick={onDismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
      )}
    </>
  );
  return onTap
    ? <button type="button" className={className} style={style} data-tone={tone} onClick={onTap} aria-live="polite">{inner}</button>
    : <div className={className} style={style} data-tone={tone} role={role} aria-live={role === "alert" ? "assertive" : "polite"}>{inner}</div>;
}

/** A notice, in the villa view's one column — wherever the code raising it sits (the 3D canvas raises its own). */
export default function Notice(props: NoticeProps) {
  const stack = typeof document !== "undefined" ? document.getElementById(NOTICE_STACK_ID) : null;
  return stack ? createPortal(<NoticeView {...props} />, stack) : <NoticeView {...props} />;
}

/** The column every notice is drawn into, under the top bar: one place, stacked, never overlapping. `children`: the
 *  villa view's own notices; a notice raised elsewhere joins it (Notice). */
export function NoticeStack({ children }: { children?: ReactNode }) {
  return <div id={NOTICE_STACK_ID} className="notice-stack">{children}</div>;
}
