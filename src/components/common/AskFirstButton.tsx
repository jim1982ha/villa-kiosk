// src/components/common/AskFirstButton.tsx
// A button whose press cannot be taken back: it asks first, in its own place (InlineConfirm), and does it at the
// second press.
//
// ⚠️ WRITTEN OUT THREE TIMES, AND FORGOTTEN A FOURTH (owner, 2026-11-10: "a bin that deletes at one press asks first"):
// "Log Out All" and the Today tab's "Delete all" each kept their own "am I asking" state around the same two buttons,
// and the telemetry's "Clear" erased every event the server keeps at one press. The two steps are hooks/useAskFirst's,
// as a device's switch; a card's bin asks in its bar instead (fm/RecordCard `bin`).

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useAskFirst } from "@/hooks/useAskFirst";
import InlineConfirm from "./InlineConfirm";

export default function AskFirstButton({ confirmLabel, question, onConfirm, children, ...button }: {
  /** The danger button's words ("Log out every device?"). */
  confirmLabel: string;
  /** Said before the two buttons, when the danger button's words alone do not say what is asked. */
  question?: string;
  onConfirm: () => unknown;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type">) {
  const { asking, request, confirm, cancel } = useAskFirst({ question: question ?? confirmLabel, confirmLabel },
    () => { void onConfirm(); });
  return asking
    ? <InlineConfirm question={question} confirmLabel={confirmLabel} onConfirm={confirm} onCancel={cancel} />
    : <button type="button" {...button} onClick={request}>{children}</button>;
}
