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
// ⚠️ THE POLICY, IN ONE SENTENCE: a dialog holding unsaved edits ends in
// [Cancel] [Save]; a dialog holding none ends in [Close]. The label of the exit
// button is therefore always TRUE — "Cancel" is a promise to discard, and
// offering it on a dialog whose every control already applied live (Settings'
// sliders write straight to the scene, the entity table writes through
// `ConfigContext`) would promise an undo that does not exist. Save is never
// hidden while a draft exists and never shown while there is nothing to commit,
// so its position is learnable — the complaint that put it in the footer in the
// first place.
//
// ⚠️ AND THE ACTIONS STAY ON ONE ROW; THE NOTE YIELDS. Reported from a phone:
// Save sat above Close because the explanatory span beside them claimed its
// full intrinsic width. `.settings-footer`'s own CSS handles that — see its
// comment — which is another reason this markup belongs in one place.

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
  save: () => void | Promise<unknown>;
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
        <button className={dirty ? "btn ghost" : "btn primary"}
                onClick={() => { commit?.discard?.(); onClose(); }}>
          {dirty ? "Cancel" : "Close"}
        </button>
        {dirty && (
          <button className="btn primary" disabled={busy || saving}
                  onClick={() => { void commit?.save(); }}>
            <SaveIcon size={16} />
            <span>{saving ? "Saving…" : "Save"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
