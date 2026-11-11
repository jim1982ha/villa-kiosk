// src/components/common/EmptyLine.tsx
// THE line a list, a chart or a section says when it has nothing to show ("No tasks yet.", "Nothing needs
// attention."): quiet words at one distance from what is around them (.empty-line, 08-shared.css).
//
// ⚠️ IT WAS WRITTEN IN EACH PLACE (owner, 2026-11-10: "only 1 definition for all similar UI elements"): a paragraph
// here (the browser's own margins, plus a padding in the Cockpit), a bare block there (none), a span in one: the same
// words sat 0, 8, 15 or 23 px under their title. `className`: where it sits (a chart's centre), never how it looks.

import type { ReactNode } from "react";

export default function EmptyLine({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={`empty-line${className ? ` ${className}` : ""}`}>{children}</p>;
}
