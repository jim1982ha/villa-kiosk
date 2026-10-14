// src/components/settings/Fold.tsx
// A settings section's working part, folded under its description until asked for.
//
// ⚠️ FOLDED BY DEFAULT (owner, 2026-10-14): Grouped Devices and Bound 3D objects opened on their whole working
// surface — a picker, a filter, every group, three list buttons — under a description that already says what the
// section is for. Folded, a section reads as its description and one line saying what is inside. The line wears the
// disclosure style the Tickets tab's folded lists use (.fm-disclosure), so every fold in the app opens the same way.

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export default function Fold({ summary, children }: {
  /** What is inside, said in the closed line ("9 groups · 15 suggested"). */
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fm-disclosure" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {summary}
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </>
  );
}
