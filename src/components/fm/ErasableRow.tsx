// src/components/fm/ErasableRow.tsx
// A Facility row whose record can be erased for good — press and hold, then
// enter the superadmin code.
//
// Exists so "which rows can be erased, and how" is answered once. Every such
// row gets the same gesture, the same prompt and the same hint: a small dot in
// the corner, meaningless to anyone who hasn't been told what it is, obvious
// to anyone who has. An earlier hint dot on the HUD category icons was removed
// as clutter (v2.59.0), so this one is deliberately fainter and appears only
// on rows that actually offer the capability.

import type { ReactNode } from "react";
import { useSuperadminDelete } from "@/hooks/useSuperadminDelete";
import type { ElevationIntent } from "@/auth/SuperadminGate";

interface Props {
  intent: ElevationIntent;
  erase: (elevation: string) => Promise<void>;
  className?: string;
  /** Tapping the row opens it for editing. Optional — a row with no editor
   *  stays a plain, non-clickable record. */
  onOpen?: () => void;
  children: ReactNode;
}

export default function ErasableRow({ intent, erase, className, onOpen, children }: Props) {
  const hold = useSuperadminDelete(intent, erase);
  const { consumeClick, ...pointerHandlers } = hold;
  return (
    <div
      className={`fm-row fm-erasable${className ? ` ${className}` : ""}${onOpen ? " fm-openable" : ""}`}
      // Focusable so the hold gesture has a keyboard equivalent (hold
      // Enter/Space) rather than being touch-and-mouse only.
      tabIndex={0}
      role={onOpen ? "button" : undefined}
      onClick={(e) => {
        // A completed hold is followed by a click. Opening the editor
        // underneath the authorisation prompt would be exactly wrong.
        if (consumeClick() || !onOpen) return;
        // Controls inside the row (status buttons, the device chip) are their
        // own actions; only a tap on the row's own surface opens it.
        if ((e.target as HTMLElement).closest("button,a,input,select,textarea")) return;
        onOpen();
      }}
      {...pointerHandlers}
    >
      {children}
      <span className="fm-erasable-dot" aria-hidden="true" />
    </div>
  );
}
