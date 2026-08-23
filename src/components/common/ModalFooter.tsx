// src/components/common/ModalFooter.tsx
//
// The pinned action row every `.settings-modal` ends in, and the app's ONE
// saving policy expressed as a component.
//
// ⚠️ IT IS A COMPONENT BECAUSE THE CONVENTION WAS NOT ENOUGH. `test_modal_shell`
// exists precisely because this footer was a set of class names every dialog
// re-stated by hand — and one of them re-stated it without a Close button at
// all. Six dialogs then re-stated the same span-then-buttons markup and three
// different ideas about where a Save goes. The test could notice a missing
// part; it could not make the parts identical. This can.
//
// ⚠️ THREE BUTTONS, ICON-ONLY, EQUAL WIDTH, IN ONE ORDER: Cancel · Save ·
// Close. Each does exactly one thing, which is what the previous two designs
// got wrong in opposite directions — first a label that changed as you typed
// ("2 different configurations fighting"), then a Save that also closed, so
// there was no way to commit and keep working.
//
//   Cancel   discards the draft AND closes. One press, no question: the
//            operator has just said they do not want their changes.
//   Save     commits and STAYS. It is the only button that does not close.
//   Close    closes — but asks first if there is anything unsaved, because a
//            dialog that discards silently is how an edit disappears.
//
// ⚠️ SAVE IS THE ONLY ONE THAT GREYS. Cancel and Close are always live: they
// are the two ways out, these dialogs have no X, and Escape and the backdrop
// are not discoverable on a wall-mounted tablet — which is what
// `test_modal_shell` was written for after a dialog shipped with no exit.
//
// ⚠️ ICON-ONLY IS A PHONE DECISION AS MUCH AS A TIDINESS ONE. Three labelled
// buttons plus a version string do not fit a 360px footer, and the previous row
// wrapped there. Three 44px squares always fit, and 44 is `--touch-min` on both
// axes rather than a painted box that happens to look big enough.
//
// ⚠️ AND THE UNSAVED QUESTION IS ONE COMPONENT, shared with `ModalTabs` —
// switching tab and closing ask the same thing, and two copies would drift on
// the answer that matters: which one the backdrop maps to.

import { useState, type ReactNode } from "react";
import { Save as SaveIcon, Undo2, X } from "lucide-react";

import UnsavedChanges from "./UnsavedChanges";

/** An editable draft a dialog can commit. ⚠️ THE DIALOG OWNS IT, NOT THIS
 *  COMPONENT: a draft that lives in the footer would be lost the moment a tab
 *  strip re-rendered, and two panels editing one document need one owner above
 *  both of them (see `AgentConfigDraft`).
 *
 *  ⚠️ EXPORTED WITH NO NAMED IMPORTER, AND THAT IS THE VERDICT RATHER THAN AN
 *  OVERSIGHT — recorded here so the residue sweep stops re-adjudicating it.
 *  `AgentConfigDraft` satisfies this shape STRUCTURALLY, which is what lets a
 *  draft owner be passed straight in; the interface is the written contract for
 *  the next dialog that wants a Save, and it is the thing to implement rather
 *  than a prop list to copy. */
export interface ModalCommit {
  /** Is there anything to save? Drives the whole footer. */
  dirty: boolean;
  saving?: boolean;
  /** Shown in place of the note, as an alert. */
  error?: string | null;
  /** Commit. ⚠️ RESOLVE `false` TO SAY IT FAILED — anything else (including
   *  `undefined`) is taken as success and CLOSES the dialog. A refused write
   *  must leave the dialog open with its error, or the operator watches their
   *  edit disappear and has no idea it did not land. */
  save: () => void | boolean | Promise<unknown>;
  /** Throw the draft away. ⚠️ OPTIONAL, BUT ITS ABSENCE IS A REAL STATE: a
   *  dialog that cannot discard should not offer Cancel, so it simply keeps
   *  Close and the caller passes no commit at all. */
  discard?: () => void;
}

export default function ModalFooter({
  note, leading, commit, onClose, busy = false,
}: {
  /** The left-hand hint. Yields its width to the buttons. */
  note?: ReactNode;
  /** A left-hand CONTROL rather than a hint — Settings' "Advanced Settings"
   *  opener. ⚠️ It stays on the left rather than joining the action group: it
   *  navigates somewhere else, and a button that leaves the dialog must not sit
   *  in the row where Save and Close are. Wins over `note`. */
  leading?: ReactNode;
  commit?: ModalCommit | null;
  onClose: () => void;
  busy?: boolean;
}) {
  const dirty = commit?.dirty === true;
  const saving = commit?.saving === true;
  /** Set when Close was pressed with a draft pending. */
  const [asking, setAsking] = useState(false);

  const close = () => (dirty ? setAsking(true) : onClose());
  const cancel = () => { commit?.discard?.(); onClose(); };

  return (
    <div className="settings-footer">
      {commit?.error
        ? <span className="body-text sev-warning" role="alert">{commit.error}</span>
        : leading !== undefined
        ? leading
        : note
          ? <span className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>
              {note}
            </span>
          // ⚠️ THE EMPTY SPACER IS LOAD-BEARING. `.settings-footer` is
          // `space-between`, so the group renders on the LEFT without a first
          // child to push against — a bug CockpitModal shipped and every other
          // single-button footer worked around by hand.
          : <span />}

      {/* ⚠️ TITLE AND ARIA-LABEL ON EVERY ONE. An icon-only control is
          unreadable to a screen reader and ambiguous to everyone else without
          them, and these three differ only in consequence. */}
      <div className="modal-footer-actions">
        <button
          className="btn ghost"
          aria-label="Cancel — discard any changes and close"
          title="Cancel — discard any changes and close"
          onClick={cancel}
        >
          <Undo2 size={18} aria-hidden />
        </button>
        <button
          className="btn primary"
          disabled={busy || saving || !dirty}
          aria-label={dirty ? "Save" : "Nothing to save"}
          title={commit
            ? (dirty ? "Save — stores your changes and stays here"
                     : "Nothing has been changed yet")
            : "Everything in this dialog applies as you change it — there is "
              + "nothing waiting to be saved"}
          onClick={() => { void commit?.save(); }}
        >
          <SaveIcon size={18} aria-hidden />
        </button>
        <button
          className="btn"
          aria-label="Close"
          title="Close"
          onClick={close}
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      {asking && (
        <UnsavedChanges
          saving={saving}
          onSave={() => {
            // ⚠️ CLOSES ONLY IF THE WRITE SUCCEEDED. A refused save that closed
            // anyway would show the operator their edit vanishing while the
            // error explaining it went with the dialog.
            void Promise.resolve(commit?.save()).then((ok) => {
              setAsking(false);
              if (ok !== false) onClose();
            });
          }}
          onDiscard={() => { setAsking(false); cancel(); }}
          onStay={() => setAsking(false)}
        />
      )}
    </div>
  );
}
