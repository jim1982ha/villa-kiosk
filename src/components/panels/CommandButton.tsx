// src/components/panels/CommandButton.tsx
// A button that sends a device ONE command (Play / Pause, a blind's Open, a camera's "Turn left"): it says the press
// landed, as the power button does, until the device moves (usePendingAck; the look is the one `button[aria-busy]`
// rule, 03-panels.css).
//
// ⚠️ ONLY THE POWER BUTTON AND THE LOCK SAID IT (UI scan, 2026-11-10): every other command button stayed as it was
// from the press to the device's answer, which on a slow device reads as "did that even register?" and invites a
// second press. A choice among several (a mode, a speed) is DeviceChoice; a button that asks first keeps the hook
// itself (PowerToggle, LockPanel, the lists' "turn all off").

import Button, { type ButtonProps } from "@/components/common/Button";
import { usePendingAck } from "@/hooks/usePendingAck";
import { tapFeedback } from "@/utils/haptics";

export default function CommandButton({ watch, send, ...button }: {
  /** What the device reports that this command moves (its state, its position): any change ends the waiting. */
  watch: unknown;
  /** Send it, handing the command's outcome back: a refused one ends the waiting at once. */
  send: () => unknown;
} & Omit<ButtonProps, "type" | "onClick" | "busy">) {
  const { pending, markPending } = usePendingAck(watch);
  return <Button busy={pending} onClick={() => { tapFeedback(); markPending(send()); }} {...button} />;
}
