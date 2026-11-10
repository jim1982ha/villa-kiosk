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
import Answers, { type Answer } from "./Answers";
import BackButton from "./BackButton";
import FooterNote from "./FooterNote";
import { useWindowLeave } from "./Window";

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
interface ModalCommit {
  /** Is there anything to save? Drives the whole footer. */
  dirty: boolean;
  saving?: boolean;
  /** Why the last Save was refused: a line above the footer (common/FooterNote). */
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
  note, leading, back, commit, answer, error, onClose, busy = false, closeLabel, actions,
}: {
  /** The left-hand hint. Yields its width to the buttons. */
  note?: ReactNode;
  /** A left-hand CONTROL rather than a hint — Settings' "Advanced Settings"
   *  opener. ⚠️ It stays on the left rather than joining the action group: it
   *  navigates somewhere else, and a button that leaves the dialog must not sit
   *  in the row where Save and Cancel are. Wins over `note`. */
  leading?: ReactNode;
  /** A window opened from another one: its Back, at the left (`to`: where it returns). ⚠️ ONLY WHERE THERE IS NO
   *  CANCEL (architecture review K, 2026-10-24): beside Save · Cancel a Back was a third way out that said nothing of
   *  the changes, so with a `commit` it is not drawn and Cancel is the way out. Escape stays the footer's way out. */
  back?: { go: () => void; to?: string };
  /** The dialog's draft. ⚠️ OMITTED (undefined) = a dialog with NOTHING TO
   *  SAVE — the legend, a colour picker, the Cockpit, a device panel: the
   *  footer is then the left slot and ONE primary exit (`closeLabel`, "Close"
   *  by default), the shape eight dialogs wrote out by hand with their own
   *  `<span />` spacer until 2.496.263. `null` keeps Save · Cancel with Save
   *  explaining that changes apply as they are made. */
  commit?: ModalCommit | null;
  /** A window that asks ONE thing (a question box, "Open a ticket", "Report a problem"): Cancel (`onClose`) and this
   *  answer, the same pair as Save · Cancel (common/Answers). */
  answer?: Answer;
  /** Why that answer was refused: a line above the footer (common/FooterNote). */
  error?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  /** The exit's own word: the one exit's in a nothing-to-save footer ("Got it, thanks"), Cancel's beside an `answer`
   *  ("Keep"). */
  closeLabel?: string;
  /** Controls on the right, before Cancel and Save. ⚠️ IN A NOTHING-TO-SAVE FOOTER THEY REPLACE ITS Close: the
   *  window's way out is then its header's Back (common/BackButton; owner, 2026-10-24, Advanced Settings). */
  actions?: ReactNode;
}) {
  const dirty = commit?.dirty === true;
  const saving = commit?.saving === true;
  const notice = useAppNotice();
  const { save, cancel } = footerExits(commit ?? null, onClose, notice);
  // the one exit of a window with nothing to save is no answer to a form drawn in it: it asks first (common/Window)
  const leave = useWindowLeave()(onClose);

  // ⚠️ THE EMPTY SPACER IS LOAD-BEARING. `.modal-footer` is `space-between`,
  // so the right-hand group renders on the LEFT without a first child to push
  // against — a bug CockpitModal shipped and every other single-button footer
  // worked around by hand.
  const left = back && commit === undefined && !answer
    ? <BackButton onClick={back.go} label={back.to} footer />
    : leading !== undefined && leading !== null && leading !== false
    ? leading
    : note
      ? <span className="muted body-text" style={{ fontSize: "var(--text-xs)" }}>{note}</span>
      : <span />;

  // ⚠️ ONE GROUP, ONE PAIR (owner, 2026-10-22: one footer; 2026-11-10: one definition): every footer's buttons sit in
  // the same group at the right, and whatever asks for an answer draws the same Cancel and answer (common/Answers).
  const right = answer
    ? <Answers answer={answer} onCancel={onClose} cancelLabel={closeLabel} />
    : commit === undefined
    // nothing to save: the one exit, in the answers' shape (owner, 2026-11-10: the Cockpit's "Close" was a word pill
    // beside Settings' round buttons on the same phone): its glyph and its word, the glyph alone on a phone. A
    // window's own word stays words.
    ? actions ?? (closeLabel
      ? <button type="button" className="btn primary" onClick={leave}>{closeLabel}</button>
      : <button type="button" className="btn primary" aria-label="Close" onClick={leave}>
          <X size={18} aria-hidden /><span className="btn-label">Close</span>
        </button>)
    // ⚠️ THE PRIMARY ANSWER ON THE RIGHT, WHERE EVERY OTHER WINDOW'S Close IS (owner, 2026-10-22: Settings' footer
    // "differs from the other modals"): Cancel, then Save. ⚠️ A TOOLTIP AND A NAME ON BOTH, INDEPENDENTLY OF THE
    // VISIBLE WORD: the word is hidden on a phone, and the tooltip (common/Tip) explains the CONSEQUENCE, which the
    // one-word label deliberately does not.
    : <Answers extra={actions} onCancel={cancel}
        cancelTip={dirty ? "Cancel, undoes every change made here, on every tab, and closes" : "Cancel, closes"}
        answer={{
          label: "Save", icon: <SaveIcon size={18} aria-hidden />, terse: true, onPress: save,
          disabled: busy || saving || !dirty, name: dirty ? "Save" : "Nothing to save",
          tip: commit
            ? (dirty ? "Save, stores your changes, applies them and closes" : "Nothing has been changed yet")
            : "Everything in this dialog applies as you change it, there is nothing waiting to be saved",
        }} />;

  return (
    <>
      <FooterNote lines={[commit?.error ?? error]} />
      <div className="modal-footer">
        {left}
        <div className="btn-row end">{right}</div>
      </div>
    </>
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
      // ⚠️ NOTHING IS SAVED AT ONCE IN A DIALOG WITH A SAVE (owner, 2026-11-06: one way of saving), so Cancel never
      // has a section to name as kept: what changed is cancelled, or nothing is said
      if (changed) notice({ text: CANCELLED_NOTICE, tone: "info" });
    },
  };
}

export const SAVED_NOTICE = "All changes saved and applied.";
export const CANCELLED_NOTICE = "All changes cancelled, nothing was kept.";
