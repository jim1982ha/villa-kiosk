// src/components/fm/ErasableRow.tsx
// A Facility row whose record can be erased for good — press and hold, then
// enter the superadmin code.
//
// Exists so "which rows can be erased, and how" is answered once. Every such
// row gets the same gesture and the same prompt.
//
// ⚠️ NO HINT DOT (owner, 2026-11-04: "what is the top right pill (light grey)
// for … it never disappears"): a faint dot in each erasable row's corner was
// the gesture's hint, meaningless to anyone not told, and it sat on the cards'
// time pill. The gesture is the superadmin's, who knows it; the dot went, as
// the HUD category icons' did (v2.59.0).

import type { ReactNode } from "react";
import { useSuperadminDelete } from "@/hooks/useSuperadminDelete";
import type { ElevationIntent } from "@/auth/SuperadminGate";

interface Props {
  intent: ElevationIntent;
  erase: (elevation: string) => Promise<unknown>;
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
    </div>
  );
}
