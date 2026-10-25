// src/hooks/useConfirmDialog.tsx
// "Are you sure?" before a tap that cannot be taken back: the question, the
// haptic and the action, owned once.
//
// ⚠️ ONE HOOK FOR EVERY SUCH TAP (owner, 2026-10-25: "show a confirmation
// message, the same way there is a confirmation message to act on Scene, fully
// re-use the same code"). Running a scene asked first; sounding a camera's
// siren did not. Both now ask through this hook, so they look and behave alike
// and a third tap of the kind gets the same question by calling it.
//
// ⚠️ `AskDialog`, NOT AN INLINE Cancel/Confirm PAIR. The inline pattern
// (`PowerToggle`, the bulk toggle) works where the control can be replaced in
// place; a scene lives inside `role="menu"`, where swapping a `menuitem` for
// two buttons breaks the menu's own contract. AskDialog is this app's
// `confirm()` and already carries the focus trap, Escape and phone-Back.

import { useState } from "react";

import AskDialog from "@/components/common/AskDialog";
import { successFeedback } from "@/utils/haptics";

export interface Question {
  title: string;
  /** What makes a person read the title again — not "Are you sure?". */
  message: string;
  confirmLabel: string;
  /** Sent only when the person confirms. */
  run: () => void;
}

interface ConfirmDialog {
  /** Ask this question. Nothing is sent until the person confirms. */
  ask: (q: Question) => void;
  /** Render this somewhere in the surface's tree. `null` when nothing is asked. */
  dialog: React.ReactNode;
}

export function useConfirmDialog(): ConfirmDialog {
  const [pending, setPending] = useState<Question | null>(null);
  return {
    ask: setPending,
    dialog: pending && (
      <AskDialog
        title={pending.title}
        message={pending.message}
        confirmLabel={pending.confirmLabel}
        cancelLabel="Cancel"
        onConfirm={() => {
          // ⚠️ THE HAPTIC FIRES ON THE CONFIRM, NOT ON THE FIRST TAP. It is the
          // acknowledgement that something was actually sent; on the opening
          // tap it would say "done" about a question.
          successFeedback();
          pending.run();
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    ),
  };
}
