// src/components/common/AskDialog.tsx
// The app's own replacement for `window.prompt` / `confirm` / `alert`.
//
// ⚠️ A NATIVE DIALOG IS THE ONE SURFACE THIS APP CANNOT STYLE, AND THE TARGET
// IS A WALL-MOUNTED iPAD. `prompt()` and friends draw an OS sheet with the
// site's ORIGIN in the title — under HA Ingress that is a long opaque URL — so
// on a kiosk they read as the browser breaking through the app rather than as
// the app asking a question. They also ignore the dismissal contract every
// other dialog here honours (Escape and the phone's Back, through
// useBackToClose's stack), and they block the whole tab while open, which on
// this app means the Babylon render loop with it.
//
// ⚠️ WHAT THEY ARE *NOT* GUILTY OF, corrected here because the first version of
// this comment got it wrong: focus cannot escape a native dialog. `alert`,
// `confirm` and `prompt` are browser-modal — they pause script execution and the
// page behind them is uninteractable, so Tab cannot reach the villa controls
// under the scrim. That failure is real but belongs to the app's OWN ten
// `.modal-backdrop` surfaces, which is what useModalA11y was written for; it was
// transplanted onto native dialogs where it does not apply. This component DOES
// carry the focus trap, and that is a property it has, not a bug it fixed.
//
// Five of them shipped — two in GroupedDevices, three in TeleportMenu — and the
// last was added by me during a /dry-audit, which is how it became visible:
// following an existing pattern is exactly how a native dialog gets its sixth
// call site.
//
// ── WHY ONE COMPONENT FOR ALL THREE ──────────────────────────────────────────
// alert / confirm / prompt are the same dialog with progressively more of it
// shown: a message, a choice, a field. Modelling them as one component with
// optional parts means a caller cannot accidentally give a destructive action
// the styling of a notice, and the focus/Escape/Back contract is written once.
//
// ⚠️ `onConfirm` MAY RETURN AN ERROR STRING, and that is the point of it. The
// native flow for "this name is taken" is prompt → alert → prompt, which loses
// what the user typed and asks them twice. Returning a string keeps the dialog
// open with the text intact and the reason under the field.

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";

interface Props {
  title: string;
  /** Optional body text. Omit for a bare prompt whose label says enough. */
  message?: string;
  /** Present → a text field is shown, and its value is passed to `onConfirm`. */
  input?: { label: string; placeholder?: string; initial?: string };
  confirmLabel?: string;
  /** null hides the cancel button entirely — that is the `alert()` shape. */
  cancelLabel?: string | null;
  /** Paints the confirm button as destructive (`.btn.danger`). */
  danger?: boolean;
  /**
   * An optional THIRD action, between cancel and confirm.
   *
   * ⚠️ IT EXISTS FOR THE UNSAVED-CHANGES QUESTION, WHICH IS GENUINELY
   * THREE-WAY: save, discard, or stay where you are. Squeezing that into two
   * buttons forces one of the three onto Escape and the backdrop — and whichever
   * one lands there is taken by accident, which for "discard" means silently
   * losing an edit. So the third button is explicit and `onCancel` keeps the
   * meaning it has everywhere else in this app: the harmless one.
   */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** ⚠️ ICONS, BECAUSE A ROW OF BARE TEXT PILLS READS AS THREE UNRELATED
   *  CONTROLS. Every other action row in this app pairs a glyph with its word;
   *  this dialog was the one that did not, and it was reported from the
   *  screen. Optional: a one-button `alert()` shape needs none. */
  confirmIcon?: LucideIcon;
  secondaryIcon?: LucideIcon;
  cancelIcon?: LucideIcon;
  /**
   * Return a string to REJECT: the dialog stays open, the text is kept, and the
   * string is shown under the field. Return nothing to accept and close.
   */
  onConfirm: (value: string) => string | void;
  onCancel: () => void;
}

export default function AskDialog({
  title, message, input, confirmLabel = "OK", cancelLabel = "Cancel",
  danger = false, secondaryLabel, onSecondary, onConfirm, onCancel,
  confirmIcon: ConfirmIcon, secondaryIcon: SecondaryIcon,
  cancelIcon: CancelIcon,
}: Props) {
  const dialogRef = useModalA11y(onCancel);
  const [value, setValue] = useState(input?.initial ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = value.trim();
    // The field is REQUIRED when present: an empty answer is a cancel that
    // looks like a confirm, and the native prompt returning "" for both is
    // exactly the ambiguity this replaces.
    if (input && !trimmed) { setError("Please enter a name."); return; }
    const rejection = onConfirm(trimmed);
    if (typeof rejection === "string") { setError(rejection); return; }
  };

  return (
    // Same shell as BadgeColorModal: `panel-modal` keeps a SHORT dialog as a
    // small centred card on a phone. Without it these fall through to the base
    // `.modal` rules, which are written for long full-screen sheets and would
    // render a two-line question edge-to-edge with square corners.
    <div className="modal-backdrop panel-modal-backdrop" onClick={onCancel} style={{ zIndex: 90 }}>
      <div
        ref={dialogRef}
        className="modal panel-modal"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="panel-header"><div className="title"><h2>{title}</h2></div></div>
        <div className="panel-body">
          {message && <p style={{ margin: input ? "0 0 14px" : 0 }}>{message}</p>}
          {input && (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ask-dialog-input">{input.label}</label>
              <input
                id="ask-dialog-input"
                // `data-autofocus` is useModalA11y's OWN way to nominate the
                // primary control — it prefers a marked element over "the first
                // focusable" when it focuses into the dialog. The first cut here
                // added a second `useEffect` doing the same job, which is two
                // mechanisms racing to focus one field and the shape of drift
                // /dry-audit exists to catch. A prompt whose field is not
                // focused costs the user a second tap, and on iOS that tap is
                // what summons the keyboard.
                data-autofocus
                type="text"
                value={value}
                placeholder={input.placeholder}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                // Enter submits, because a one-field dialog that needs a mouse
                // to accept is worse than the prompt it replaced.
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              />
            </div>
          )}
          {error && (
            <p role="alert" style={{ color: "var(--status-danger)", margin: "10px 0 0" }}>
              {error}
            </p>
          )}
        </div>
        <div className="panel-footer">
          {cancelLabel !== null && (
            <button className="btn ghost" onClick={onCancel}>
              {CancelIcon && <CancelIcon size={16} aria-hidden />}
              {cancelLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button className="btn ghost" onClick={onSecondary}>
              {SecondaryIcon && <SecondaryIcon size={16} aria-hidden />}
              {secondaryLabel}
            </button>
          )}
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={submit}>
            {ConfirmIcon && <ConfirmIcon size={16} aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
