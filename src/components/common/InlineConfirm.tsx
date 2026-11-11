// src/components/common/InlineConfirm.tsx
// The second step of a two-step action, in place of its button: an optional
// question, Cancel, and the danger button that does it.
//
// ⚠️ WRITTEN OUT FIVE TIMES (round 11, 2.496.173) — the power toggle, the
// lock's unlock, a device group's "all on/off", "log out every device" and
// "delete all tasks" — each its own block with the same two buttons, the same
// classes and the same margin override in four of them.
// AskDialog is the modal form; this is the inline one. Both draw the app's one pair (common/Answers).

import type { ReactNode } from "react";

import Answers from "./Answers";

export default function InlineConfirm({ question, confirmLabel, onConfirm, onCancel, flush = true }: {
  /** Shown before the buttons (left-aligned), when the confirm label alone
   *  does not say what is being asked. */
  question?: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  /** No outer margin — sitting in a header or a row. */
  flush?: boolean;
}) {
  return (
    <div className={`btn-row end${flush ? "" : " below"}`}>
      {question !== undefined && <span className="body-text btn-row-says">{question}</span>}
      <Answers onCancel={onCancel} answer={{ label: confirmLabel, danger: true, onPress: onConfirm }} />
    </div>
  );
}
