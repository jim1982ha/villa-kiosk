// src/components/panels/CommandButton.tsx
// A button that sends a device ONE command (Play / Pause, a blind's Open, a camera's "Turn left"): it says the press
// landed, as the power button does, until the device moves (usePendingAck; the look is the one `button[aria-busy]`
// rule, 03-panels.css).
//
// ⚠️ ONLY THE POWER BUTTON AND THE LOCK SAID IT (UI scan, 2026-11-10): every other command button stayed as it was
// from the press to the device's answer, which on a slow device reads as "did that even register?" and invites a
// second press. A choice among several (a mode, a speed) is DeviceChoice; a button that asks first keeps the hook
// itself (PowerToggle, LockPanel, the lists' "turn all off").

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { usePendingAck } from "@/hooks/usePendingAck";
import { tapFeedback } from "@/utils/haptics";

export default function CommandButton({ watch, send, className = "btn", children, ...rest }: {
  /** What the device reports that this command moves (its state, its position): any change ends the waiting. */
  watch: unknown;
  /** Send it, handing the command's outcome back: a refused one ends the waiting at once. */
  send: () => unknown;
  /** How the button looks where it sits: a window's `.btn` unless said (`.media-btn` over a video). */
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onClick" | "className" | "children">) {
  const { pending, markPending } = usePendingAck(watch);
  return (
    <button type="button" className={className} aria-busy={pending || undefined}
      onClick={() => { tapFeedback(); markPending(send()); }} {...rest}>
      {children}
    </button>
  );
}
