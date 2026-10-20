// src/components/common/ModalTabs.tsx
//
// The tab strip every settings-family modal wears. ONE implementation.
//
// ⚠️ IT EXISTED ONCE BEFORE THIS FILE, AND ADVANCED SETTINGS WAS ABOUT TO MAKE
// TWO. Facility carried the same fifteen lines — `.fm-tabs` / `role="tablist"`,
// a `.fm-tab` button per entry with `aria-selected`, an icon and a label — and
// hand-copying them a second time carries only the parts the copier notices.
// `role`/`aria-selected` are the half nobody misses until a screen reader is
// used.
//
// ⚠️ THE SCROLL-INTO-VIEW IS PART OF THE COMPONENT, NOT AN EXTRA. `.fm-tabs`
// scrolls horizontally, so a surface opened directly onto a tab that is off
// screen shows the row still highlighting the FIRST tab — an operator who
// tapped "report a fault" sees the fault form under a tab bar that appears to
// be on Today. Facility's own copy never had this, so converging it here is
// what fixes the copy that did not know it was broken.
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
  tabs, active, onSelect, label,
}: {
  tabs: readonly ModalTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  /** Names the tablist for assistive tech — "Facility sections". */
  label: string;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
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
            onClick={() => onSelect(t.id)}
          >
            <Icon size={16} /><span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
