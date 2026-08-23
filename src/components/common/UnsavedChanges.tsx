// src/components/common/UnsavedChanges.tsx
//
// The one question asked whenever a draft is about to be walked away from.
//
// ⚠️ TWO GESTURES ASK IT AND THEY MUST NOT ASK IT DIFFERENTLY: switching tab
// (`ModalTabs`) and closing the dialog (`ModalFooter`). Two copies would drift
// in wording, in button order and — the one that matters — in which answer the
// backdrop maps to, which is the difference between discarding an edit by
// accident and not.
//
// ⚠️ THREE ANSWERS, THREE BUTTONS, AND ESCAPE MEANS STAY. Squeezing this into
// two puts one answer on the backdrop where it is taken by accident, and the
// one that would land there is "discard".
//
// ⚠️ EVERY BUTTON CARRIES AN ICON AND STAYS ON ONE LINE. The first version
// rendered three text pills, two of which wrapped onto two lines at the width
// this dialog opens at — reported as looking "very different from the rest of
// the UI". A wrapped button is a different height from its neighbours, which is
// what makes a row of them read as three unrelated controls.

import { Save, Undo2, X } from "lucide-react";

import AskDialog from "./AskDialog";

export default function UnsavedChanges({
  onSave, onDiscard, onStay, saving = false,
}: {
  /** Commit, then continue. ⚠️ MUST RESOLVE `false` ON FAILURE — continuing
   *  after a refused write leaves the operator believing it landed, which is
   *  the failure this question exists to prevent, arriving through its own
   *  fix. */
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
  saving?: boolean;
}) {
  return (
    <AskDialog
      title="You have unsaved changes"
      message="Save them, throw them away, or stay where you are."
      confirmLabel={saving ? "Saving…" : "Save"}
      confirmIcon={Save}
      secondaryLabel="Discard"
      secondaryIcon={Undo2}
      cancelLabel="Stay"
      cancelIcon={X}
      onConfirm={() => { onSave(); }}
      onSecondary={onDiscard}
      onCancel={onStay}
    />
  );
}
