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
// ⚠️ TWO BUTTONS: Save · Close. It was THREE until 2.770.0, and the third was
// redundant on its own terms.
//
//   Save     commits and STAYS. It is the only button that does not close.
//   Close    closes — asking first if there is anything unsaved, and that
//            question already offers Save · Discard · Stay.
//
// ⚠️ CANCEL WAS DELETED BECAUSE `UnsavedChanges` ALREADY OFFERS IT. Its only
// distinct behaviour was "discard without being asked", which is exactly the
// Discard answer in the dialog Close raises — so the footer carried a shortcut
// past a safety question, one press from an edit gone with no confirmation. On
// a clean draft it was indistinguishable from Close, which is the worse half:
// two buttons that did the same thing most of the time and quietly different
// things the rest. Standard behaviour is one exit that asks; the owner asked
// for it in those terms and they are right.
//
// ⚠️ SAVE IS THE ONLY ONE THAT GREYS. Close is always live: it is now the ONLY
// way out, these dialogs have no X, and Escape and the backdrop are not
// discoverable on a wall-mounted tablet — which is what `test_modal_shell` was
// written for after a dialog shipped with no exit. A `disabled` on Close would
// now strand the operator completely rather than merely inconvenience them.
//
// ⚠️ LABELLED ON DESKTOP, ICON-ONLY ON A PHONE. Three labelled buttons plus a
// version string did not fit a 360px footer and the row wrapped, which is why
// everything went icon-only in 2.667.0. Two do fit with room to spare, so the
// label is restored where there is width for it and dropped at the phone tier —
// the icon and `--touch-min` square are unchanged there. The accessible name is
// on the button either way, so the visible text is never the only label.
//
// ⚠️ AND THE UNSAVED QUESTION IS ONE COMPONENT, shared with `ModalTabs` —
// switching tab and closing ask the same thing, and two copies would drift on
// the answer that matters: which one the backdrop maps to.

import { useState, type ReactNode } from "react";
import { Save as SaveIcon, X } from "lucide-react";

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
  /** Throw the draft away. ⚠️ STILL REQUIRED AFTER THE CANCEL BUTTON WENT: it
   *  is what the Discard answer in `UnsavedChanges` calls. Removing the button
   *  removed a shortcut, not the capability — a dialog whose draft could not be
   *  thrown away would trap an operator who opened it by mistake. */
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
  // ⚠️ NOT A BUTTON ANY MORE — reached only through the Discard answer of the
  // question `close` raises. The draft is thrown away and the dialog goes.
  const discardAndClose = () => { commit?.discard?.(); onClose(); };

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

      {/* ⚠️ TITLE AND ARIA-LABEL ON BOTH, INDEPENDENTLY OF THE VISIBLE LABEL.
          The text is hidden at the phone tier, so a name that came from the
          text would vanish exactly where the control is hardest to identify —
          and `title` is the tooltip that explains the CONSEQUENCE, which the
          one-word label deliberately does not. */}
      <div className="modal-footer-actions">
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
          <span className="btn-label">Save</span>
        </button>
        <button
          className="btn"
          aria-label="Close"
          title={dirty ? "Close — asks what to do with your changes" : "Close"}
          onClick={close}
        >
          <X size={18} aria-hidden />
          <span className="btn-label">Close</span>
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
          onDiscard={() => { setAsking(false); discardAndClose(); }}
          onStay={() => setAsking(false)}
        />
      )}
    </div>
  );
}
