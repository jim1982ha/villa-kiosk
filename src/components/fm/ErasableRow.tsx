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
  children: ReactNode;
}

export default function ErasableRow({ intent, erase, className, children }: Props) {
  const hold = useSuperadminDelete(intent, erase);
  return (
    <div
      className={`fm-row fm-erasable${className ? ` ${className}` : ""}`}
      // Focusable so the hold gesture has a keyboard equivalent (hold
      // Enter/Space) rather than being touch-and-mouse only.
      tabIndex={0}
      {...hold}
    >
      {children}
      <span className="fm-erasable-dot" aria-hidden="true" />
    </div>
  );
}
