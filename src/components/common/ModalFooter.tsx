// src/components/common/ModalFooter.tsx
//
// The pinned action row every `.settings-modal` ends in, and the app's ONE
// saving policy expressed as a component.
//
// ⚠️ IT IS A COMPONENT BECAUSE THE CONVENTION WAS NOT ENOUGH. `test_modal_shell`
// exists precisely because this footer was a set of class names every dialog
// re-stated by hand — and one of them re-stated it without a Close button at
// all. Six dialogs then re-stated the same span-then-buttons markup, the same
// `justifyContent: space-between` inline style, and three different ideas about
// where a Save button goes. The test could notice a missing part; it could not
// make the parts identical. This can.
//
// ⚠️ THE POLICY, IN ONE SENTENCE: every dialog in this family ends in the SAME
// TWO BUTTONS — [Cancel] [Save] — and Save is live only while there is
// something to commit.
//
// ⚠️ THE FIRST VERSION SWAPPED THE LABEL INSTEAD (Close when clean, Cancel when
// dirty) so that the word was always literally true, and it was reported the
// day it shipped: "by default i see the Close button and it changes to Cancel /
// Save when a modification is done: this is very bad… It feels like 2 different
// configurations are fighting for each other". They are right, and the reason
// is one this codebase has already paid for once with the Save that lived at
// the foot of a tab: a control whose POSITION or IDENTITY moves is a control
// you cannot learn. A footer that rearranges itself in response to typing is
// the same defect in a smaller space. One fixed pair, one of them greyed, is
// the version a person can build a habit around.
//
// ⚠️ CANCEL IS NEVER DISABLED, WHICH IS THE ONE PLACE THIS DEPARTS FROM THE
// REQUEST ("the cancel shall appear un-clickable if no modification are
// registered"). It is also the dialog's ONLY visible way out: these dialogs
// have no X, and Escape and the backdrop are not discoverable on a wall-mounted
// tablet — `test_modal_shell` pins exactly that, after a dialog shipped with no
// exit at all. Disabling both buttons on a clean dialog would strand whoever
// opened it. Cancel therefore means "close, discarding anything pending", which
// is true in both states; Save is the button that greys.
//
// ⚠️ AND A DIALOG WITH NOTHING TO SAVE STILL SHOWS THE PAIR, with Save greyed
// permanently and a `title` saying why. Settings' sliders write to the scene as
// they move and the entity table writes through `ConfigContext`; there is
// genuinely nothing waiting. Hiding the button there would put a different
// footer on a third of the family, which is what this component exists to stop.
import type { ReactNode } from "react";
import { Save as SaveIcon } from "lucide-react";

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
   *  in the row where Save and Cancel are. Wins over `note`. */
  leading?: ReactNode;
  commit?: ModalCommit | null;
  /** Close, and — when a commit is dirty — discard first. */
  onClose: () => void;
  busy?: boolean;
}) {
  const dirty = commit?.dirty === true;
  const saving = commit?.saving === true;
  /** ⚠️ SAVE CLOSES THE DIALOG, which is what a person expects of the button
   *  that finishes their work — reported as "when I click on Save I don't see
   *  the modal close, whereas it should". It closes only on SUCCESS: a refused
   *  write (a revision conflict, a 403) keeps the dialog open so the error in
   *  this same footer is read rather than dismissed with the thing it explains. */
  const done = async () => {
    if (!commit) return;
    const ok = await commit.save();
    if (ok !== false) onClose();
  };
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
          // `space-between`, so a lone button renders on the LEFT without a
          // first child to push against — a bug CockpitModal shipped and every
          // other single-button footer worked around by hand.
          : <span />}
      <div className="modal-footer-actions">
        <button className="btn ghost"
                onClick={() => { commit?.discard?.(); onClose(); }}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={busy || saving || !dirty}
          title={commit
            ? (dirty ? "Store these changes"
                     : "Nothing has been changed yet")
            : "Everything in this dialog applies as you change it — there is "
              + "nothing waiting to be saved"}
          onClick={() => { void done(); }}
        >
          <SaveIcon size={16} />
          <span>{saving ? "Saving…" : "Save"}</span>
        </button>
      </div>
    </div>
  );
}
