// src/components/common/ModalTabs.tsx
//
// The tab strip every settings-family window wears: THE choose-one control (common/SegmentedGroup) said as tabs, in
// its band under the window's header. Its look is the control's own (owner, 2026-11-10: the tabs were a solid green
// block of their own beside the soft green of every other choice).
//
// ⚠️ THE SCROLL-INTO-VIEW IS PART OF THE COMPONENT, NOT AN EXTRA. The strip scrolls sideways, so a window opened
// directly onto a tab that is off screen showed the row still on its FIRST tab: an operator who tapped "report a
// fault" saw the fault form under a tab bar that appeared to be on Today.
//
// ⚠️ IT DOES NOT OWN THE SELECTION. The caller keeps the state, because which
// tabs exist is a permission question (Advanced Settings hides its System tab
// from a non-owner) and a component that owned the value could land on a tab
// its caller had just removed.
//
// A draft spans every tab of its dialog (owner, 2026-10-20: Cancel reverts the changes "on few different tabs"), so
// switching tab asks nothing: Save and Cancel in the footer decide for all of them.

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import SegmentedGroup from "./SegmentedGroup";
import { withCount } from "@/utils/countBadge";

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
  tabs, active, onSelect, label, counts,
}: {
  tabs: readonly ModalTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  /** Names the tablist for assistive tech — "Facility sections". */
  label: string;
  /** How many a tab holds, said after its name as a section's title says it: "Tickets (3)" (owner, 2026-11-01: "show
   *  their number between ()"). None, or 0: its name alone. */
  counts?: Partial<Record<Id, number>>;
}) {
  const band = useRef<HTMLDivElement>(null);
  // ⚠️ `block: "nearest"` SO A VERTICAL PAGE DOES NOT JUMP. The strip is the
  // only thing that should move; scrolling the body under the operator on open
  // is a second bug wearing the first one's fix.
  useEffect(() => {
    band.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div className="modal-tabs" ref={band}>
      <SegmentedGroup tabs layout="natural" ariaLabel={label} active={active} onChange={onSelect}
        options={tabs.map((t) => {
          const Icon = t.icon;
          return { key: t.id, label: <><Icon size={16} /><span>{withCount(t.label, counts?.[t.id])}</span></> };
        })} />
    </div>
  );
}
