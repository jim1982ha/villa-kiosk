// src/components/common/ModalTabs.tsx
//
// The tab strip every settings-family modal wears. ONE implementation.
//
// ⚠️ IT EXISTED TWICE BEFORE THIS FILE, AND SETTINGS WAS ABOUT TO MAKE THREE.
// Briefings and Facility each carried their own copy of the same fifteen lines
// — `.fm-tabs` / `role="tablist"`, a `.fm-tab` button per entry with
// `aria-selected`, an icon and a label. They agreed, which is exactly why a
// third copy was tempting and exactly the shape `/dry-audit` exists to stop: a
// hand-copied shell carries only the parts the copier noticed, and what gets
// dropped is invisible to `tsc` and to review. `role`/`aria-selected` are the
// half nobody misses until a screen reader is used.
//
// ⚠️ THE SCROLL-INTO-VIEW IS PART OF THE COMPONENT, NOT AN EXTRA. `.fm-tabs`
// scrolls horizontally, so a surface opened directly onto a tab that is off
// screen shows the row still highlighting the FIRST tab — an operator who
// tapped "report a fault" sees the fault form under a tab bar that appears to
// be on Cockpit. Facility had discovered that and grown a ref for it; Briefings
// had not, so the same bug was latent there. Moving it here fixes the copy that
// never knew it was broken, which is the whole return on converging.
//
// ⚠️ IT DOES NOT OWN THE SELECTION. The caller keeps the state, because which
// tabs exist is a permission question in two of the three surfaces
// (`canConfigure` filters the Briefings list, and Settings hides four tabs from
// a non-owner) and a component that owned the value could land on a tab its
// caller had just removed.
//
// ⚠️ BUT IT DOES OWN THE UNSAVED-CHANGES QUESTION, and that is why the strip is
// where it lives. A tab switch is the one gesture that can lose an edit without
// looking like it: the footer's Save is still sitting there, the draft is still
// in memory, and the operator has simply gone to look at something else — then
// closed the dialog. Asked for directly, and asked for EVERYWHERE it applies,
// which is what this component is: hang it off the strip and all three tabbed
// dialogs get it, including the two that have no draft today and might tomorrow.
//
// ⚠️ IT DOES NOT FIRE ON THE FOOTER'S OWN SAVE — also asked for, and it comes
// free: this only intercepts a change of TAB. Pressing Save commits and closes
// without ever passing through here.

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import AskDialog from "./AskDialog";
import type { ModalCommit } from "./ModalFooter";

export interface ModalTab<Id extends string> {
  id: Id;
  label: string;
  /** ⚠️ `LucideIcon`, NOT a hand-written `ComponentType<{size?: number}>`.
   *  The hand-written shape looks equivalent and is not — lucide's icons are
   *  `forwardRef` components whose `propTypes` do not unify with it, so `tsc`
   *  rejects every real icon and accepts nothing. Sized by this component so
   *  every strip in the app matches. */
  icon: LucideIcon;
}

export default function ModalTabs<Id extends string>({
  tabs, active, onSelect, label, commit,
}: {
  tabs: readonly ModalTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  /** Names the tablist for assistive tech — "Facility sections". */
  label: string;
  /** The dialog's draft, when it has one. ⚠️ ABSENT MEANS "nothing can be
   *  lost here", not "do not ask" — a dialog whose tabs all apply live passes
   *  nothing and switches instantly, which is correct rather than an omission. */
  commit?: ModalCommit | null;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  /** The tab the operator asked for while a draft was pending. */
  const [pendingTab, setPendingTab] = useState<Id | null>(null);

  /** ⚠️ THE GUARD IS ON THE CHANGE, NOT ON THE BUTTON. Re-selecting the tab you
   *  are already on is not a departure and must not raise a question. */
  const choose = (id: Id) => {
    if (id === active || commit?.dirty !== true) { onSelect(id); return; }
    setPendingTab(id);
  };

  // ⚠️ `block: "nearest"` SO A VERTICAL PAGE DOES NOT JUMP. The strip is the
  // only thing that should move; scrolling the body under the operator on open
  // is a second bug wearing the first one's fix.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div className="fm-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = t.id === active;
        return (
          <button
            key={t.id}
            ref={on ? activeRef : undefined}
            role="tab"
            aria-selected={on}
            className={`fm-tab${on ? " active" : ""}`}
            onClick={() => choose(t.id)}
          >
            <Icon size={16} /><span>{t.label}</span>
          </button>
        );
      })}
      {/* ⚠️ THE THREE ANSWERS ARE ALL EXPLICIT, and Escape means STAY. Squeezing
          this into two buttons puts one of them on the backdrop, where it is
          taken by accident — and the one that would land there is "discard",
          which loses the edit this dialog exists to protect. */}
      {pendingTab !== null && (
        <AskDialog
          title="You have unsaved changes"
          message={"They belong to the tab you are leaving. Saving stores them "
                   + "and takes you on; discarding throws them away."}
          confirmLabel="Save and continue"
          secondaryLabel="Discard and continue"
          cancelLabel="Stay here"
          onConfirm={() => {
            const to = pendingTab;
            setPendingTab(null);
            // ⚠️ THE SWITCH WAITS FOR THE WRITE AND IS ABANDONED IF IT FAILS.
            // A refused save (a revision conflict, a 403) that still moved the
            // operator on would leave them looking at another tab believing
            // their edit had landed — the failure this whole question exists to
            // prevent, arriving through its own fix.
            void Promise.resolve(commit?.save()).then((ok) => {
              if (ok !== false && to !== null) onSelect(to);
            });
          }}
          onSecondary={() => {
            const to = pendingTab;
            setPendingTab(null);
            commit?.discard?.();
            if (to !== null) onSelect(to);
          }}
          onCancel={() => setPendingTab(null)}
        />
      )}
    </div>
  );
}
