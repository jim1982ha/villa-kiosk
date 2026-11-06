// src/components/settings/Fold.tsx
// A settings section's working part, folded under its title until asked for.
//
// ⚠️ FOLDED BY DEFAULT (owner, 2026-10-14): Grouped Devices and Villa's former Bound 3D objects opened on their whole
// working surface — a picker, a filter, every group, three list buttons — under a description that already says what the
// section is for. Folded, a section reads as its title and what is inside.
// ⚠️ THE COCKPIT'S FOLDED SECTION (owner, 2026-11-06: "one look for this opens more"): the title is the toggle, its
// chevron before it and what is inside after it, its (i) right after (common/FoldedList ListSection); it was a grey
// line with a chevron after the title.
import { useState, type ReactNode } from "react";
import InfoTip from "@/components/common/InfoTip";
import { ListSection } from "@/components/common/FoldedList";

export default function Fold({ title, tip, summary, children }: {
  /** The section's title. */
  title: string;
  /** Its (i): what the section is for (owner, 2026-10-22: no visible description). */
  tip?: ReactNode;
  /** What is inside, after the title ("9 groups · 15 suggested"). */
  summary?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ListSection title={title} summary={summary} open={open} onToggle={() => setOpen((v) => !v)} bare
      tip={tip ? <InfoTip label={`About ${title}`}>{tip}</InfoTip> : undefined}>
      {children}
    </ListSection>
  );
}
