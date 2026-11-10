// src/components/fm/FormActions.tsx
// The end of every Facility form: why the last save was refused (the form
// keeps what was typed, 2.496.252), then Cancel · Save (2.496.263). Five
// forms wrote the error line and the `modal-actions` pair out themselves;
// only one of them carried the icons the app pairs with every action word.
//
// ⚠️ ONE SAVE AT A TIME, HERE (UI scan, 2026-11-10): only the Today form greyed its button while its save was on its
// way; a second press on the Spend, Schedule, Ticket and Spend settings forms sent the record twice. A save that
// returns a promise greys the button and says "Saving…" until it settles.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";

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
  const [saving, setSaving] = useState(false);
  const shown = useRef(true);
  useEffect(() => { shown.current = true; return () => { shown.current = false; }; }, []);
  const save = () => {
    if (saving) return;
    const sent = onSave();
    if (!(sent instanceof Promise)) return;
    setSaving(true);
    // a form that closed on its save is gone by now: nothing left to un-grey
    void sent.finally(() => { if (shown.current) setSaving(false); });
  };
  return (
    <>
      {error && <div className="fm-inline-error" role="alert">{error}</div>}
      <div className="modal-actions" style={{ marginTop: 8 }}>
        {extra}
        <button className="btn ghost" onClick={onCancel}><X size={16} aria-hidden /> Cancel</button>
        <button className="btn primary" disabled={disabled || saving} onClick={save}>
          <Check size={16} aria-hidden /> {saving ? "Saving…" : saveLabel}
        </button>
      </div>
    </>
  );
}
