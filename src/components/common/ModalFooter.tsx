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
// ⚠️ TWO BUTTONS: Save · Cancel (owner, 2026-10-20: "clicking Save shall save and close the modal, as expected in a
// standard UX … rename Close to Cancel … Cancel shall revert all done modifications", every tab of the dialog
// included). It was Save (stays) · Close (asks Save / Discard / Stay): one question too many for the two answers a
// person means.
//
//   Save     commits AND closes, then a passing notice says "saved and applied" — a refused write stays open
//            with its error (`save` resolving `false`).
//   Cancel   throws the draft away (every tab: the draft is the dialog's, one for all its tabs) and closes; the
//            notice says the changes were cancelled — said only when there were any.
//
// ⚠️ SAVE IS THE ONLY ONE THAT GREYS (nothing changed). Cancel is always live: it is the ONLY way out, these
// dialogs have no X, and Escape and the backdrop are not discoverable on a wall-mounted tablet.
//
// ⚠️ LABELLED ON DESKTOP, ICON-ONLY ON A PHONE: the icon and `--touch-min` square at the phone tier; the
// accessible name is on the button either way.

import type { ReactNode } from "react";
import { Save as SaveIcon, X } from "lucide-react";

import { useAppNotice } from "@/components/hud/AppNotice";
import Tip from "./Tip";

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
  /** Throw the draft away — every tab's (Cancel, Escape, the backdrop). */
  discard: () => void;
}

export default function ModalFooter({
  note, leading, commit, onClose, busy = false, closeLabel, actions,
}: {
  /** The left-hand hint. Yields its width to the buttons. */
  note?: ReactNode;
  /** A left-hand CONTROL rather than a hint — Settings' "Advanced Settings"
   *  opener. ⚠️ It stays on the left rather than joining the action group: it
   *  navigates somewhere else, and a button that leaves the dialog must not sit
   *  in the row where Save and Cancel are. Wins over `note`. */
  leading?: ReactNode;
  /** The dialog's draft. ⚠️ OMITTED (undefined) = a dialog with NOTHING TO
   *  SAVE — the legend, a colour picker, the Cockpit, a device panel: the
   *  footer is then the left slot and ONE primary exit (`closeLabel`, "Close"
   *  by default), the shape eight dialogs wrote out by hand with their own
   *  `<span />` spacer until 2.496.263. `null` keeps Save · Cancel with Save
   *  explaining that changes apply as they are made. */
  commit?: ModalCommit | null;
  onClose: () => void;
  busy?: boolean;
  /** The one exit's word in a nothing-to-save footer ("Got it, thanks"). */
  closeLabel?: ReactNode;
  /** Controls on the right, before Cancel and Save. ⚠️ IN A NOTHING-TO-SAVE FOOTER THEY REPLACE ITS Close: the
   *  window's way out is then its header's Back (common/BackButton; owner, 2026-10-24, Advanced Settings). */
  actions?: ReactNode;
}) {
  const dirty = commit?.dirty === true;
  const saving = commit?.saving === true;
  const notice = useAppNotice();
  const { save, cancel } = footerExits(commit ?? null, onClose, notice);

  // ⚠️ THE EMPTY SPACER IS LOAD-BEARING. `.modal-footer` is `space-between`,
  // so the right-hand group renders on the LEFT without a first child to push
  // against — a bug CockpitModal shipped and every other single-button footer
  // worked around by hand.
  const left = commit?.error
    ? <span className="body-text sev-warning" role="alert">{commit.error}</span>
    : leading !== undefined && leading !== null && leading !== false
    ? leading
    : note
      ? <span className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>{note}</span>
      : <span />;

  if (commit === undefined) {
    // the one exit in the same group, at the same size, as Settings' Save and Cancel (owner, 2026-10-22: one footer)
    return (
      <div className="modal-footer">
        {left}
        <div className="modal-footer-actions">
          {actions ?? <button className="btn primary" onClick={onClose}>{closeLabel ?? "Close"}</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-footer">
      {left}

      {/* ⚠️ A TOOLTIP AND ARIA-LABEL ON BOTH, INDEPENDENTLY OF THE VISIBLE LABEL.
          The text is hidden at the phone tier, so a name that came from the
          text would vanish exactly where the control is hardest to identify —
          and the tooltip (common/Tip, the Kiosk's own card) explains the
          CONSEQUENCE, which the one-word label deliberately does not. */}
      <div className="modal-footer-actions">
        {actions}
        {/* ⚠️ THE PRIMARY ANSWER ON THE RIGHT, WHERE EVERY OTHER WINDOW'S Close IS (owner, 2026-10-22: Settings' footer
            "differs from the other modals"): Cancel, then Save. */}
        <Tip text={dirty ? "Cancel, undoes every change made here, on every tab, and closes" : "Cancel, closes"}>
          <button
            className="btn"
            aria-label="Cancel"
            onClick={cancel}
          >
            <X size={18} aria-hidden />
            <span className="btn-label">Cancel</span>
          </button>
        </Tip>
        <Tip text={commit
          ? (dirty ? "Save, stores your changes, applies them and closes"
                   : "Nothing has been changed yet")
          : "Everything in this dialog applies as you change it, there is "
            + "nothing waiting to be saved"}>
          <button
            className="btn primary"
            disabled={busy || saving || !dirty}
            aria-label={dirty ? "Save" : "Nothing to save"}
            onClick={save}
          >
            <SaveIcon size={18} aria-hidden />
            <span className="btn-label">Save</span>
          </button>
        </Tip>
      </div>
    </div>
  );
}

/** A dialog's two exits, the same from its footer, Escape and the backdrop (`cancel`): what each does to the draft,
 *  when the dialog closes, and what the passing notice says. Pure but for the calls it is handed. */
export function footerExits(commit: ModalCommit | null, onClose: () => void,
  notice: (m: { text: string; tone: "info" }) => void) {
  return {
    save: () => {
      if (!commit?.dirty) { onClose(); return; }
      void Promise.resolve(commit.save()).then((ok) => {
        if (ok === false) return;                        // refused: stays open, its error in the footer
        onClose();
        notice({ text: SAVED_NOTICE, tone: "info" });
      });
    },
    cancel: () => {
      const changed = commit?.dirty === true;
      if (changed) commit!.discard();
      onClose();
      if (changed) notice({ text: CANCELLED_NOTICE, tone: "info" });
    },
  };
}

export const SAVED_NOTICE = "All changes saved and applied.";
export const CANCELLED_NOTICE = "All changes cancelled, nothing was kept.";
