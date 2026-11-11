// src/components/fm/FmForm.tsx
// THE frame of every Cockpit form (a ticket's, a spend entry's, a task's, a log's, the spend settings).
//
// ⚠️ A FORM OPENS WHERE IT WAS ASKED FOR, AND IN VIEW (owner, 2026-11-01: tapping a ticket opened its form at the top
// of the tab, the card left as it was below, "without focus to shift it"). An edit takes the place of the card it
// edits (each list draws its form in the card's place); every form, new or edit, brings itself into view as it
// opens, here, once, so no form can open off screen. Its heading at the top: a tall form scrolled only "nearest"
// showed its buttons and hid what it was.
//
// A form in a window: once something is typed in it, the window asks before a touch outside loses it (common/Window).

import type { ReactNode } from "react";
import { useTypedForm } from "@/components/common/Window";
import { useInView } from "@/hooks/useInView";

export default function FmForm({ children }: { children: ReactNode }) {
  const ref = useInView<HTMLDivElement>();
  return <div ref={ref} className="fm-form" {...useTypedForm()}>{children}</div>;
}
