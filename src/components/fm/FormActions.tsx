// src/components/fm/FormActions.tsx
// The end of every Facility form: why the last save was refused (the form
// keeps what was typed, 2.496.252), then Cancel · Save (2.496.263). Five
// forms wrote the error line and the `modal-actions` pair out themselves;
// only one of them carried the icons the app pairs with every action word.

import type { ReactNode } from "react";
import { Check, X } from "lucide-react";

export default function FormActions({ error, onCancel, onSave, saveLabel, disabled = false }: {
  /** The refusal to show above the buttons, or null. */
  error?: string | null;
  onCancel: () => void;
  onSave: () => unknown;
  saveLabel: ReactNode;
  disabled?: boolean;
}) {
  return (
    <>
      {error && <div className="fm-inline-error" role="alert">{error}</div>}
      <div className="modal-actions" style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={onCancel}><X size={16} aria-hidden /> Cancel</button>
        <button className="btn primary" disabled={disabled} onClick={() => { void onSave(); }}>
          <Check size={16} aria-hidden /> {saveLabel}
        </button>
      </div>
    </>
  );
}
