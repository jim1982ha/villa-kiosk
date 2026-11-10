// src/components/fm/FormActions.tsx
// The end of every Facility form: why the last save was refused (the form
// keeps what was typed, 2.496.252), then Cancel · Save (2.496.263). Five
// forms wrote the error line and the `modal-actions` pair out themselves;
// only one of them carried the icons the app pairs with every action word.
//
// ⚠️ THE PAIR AND THE LINE ARE THE APP'S (owner, 2026-11-10: one definition): the buttons are common/Answers, the
// same Cancel and answer a window's footer and a question draw, and one press at a time is theirs ("Saving…" until
// the save settles); the refusal is common/ProblemLine.

import type { ReactNode } from "react";

import Answers from "@/components/common/Answers";
import ProblemLine from "@/components/common/ProblemLine";

export default function FormActions({ error, onCancel, onSave, saveLabel, disabled = false, extra }: {
  /** The refusal to show above the buttons, or null. */
  error?: string | null;
  /** A form's own button, drawn as these are, on the left of Cancel (Spend settings' "Remove cap"). */
  extra?: ReactNode;
  onCancel: () => void;
  onSave: () => unknown;
  saveLabel: ReactNode;
  disabled?: boolean;
}) {
  return (
    <>
      <ProblemLine>{error}</ProblemLine>
      <div className="btn-row end below">
        <Answers extra={extra} onCancel={onCancel}
          answer={{ label: saveLabel, busy: "Saving…", disabled, onPress: onSave }} />
      </div>
    </>
  );
}
