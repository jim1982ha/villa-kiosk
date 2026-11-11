// src/components/common/ProblemLine.tsx
// One plain line saying what went wrong, where it went wrong: red for what was refused or did not happen, amber
// (`warn`) for what happened only in part (kept on this device alone, replaced by another device).
//
// ⚠️ WRITTEN NINE WAYS (owner, 2026-11-10: "only 1 definition for all similar UI elements"): amber at 15px in a
// footer, red at 12px in a form, red at 14px at the PIN pad and the profiles, an inline colour in the question box, a
// tinted box at the model upload. One size, one red, read aloud as it appears.

import type { ReactNode } from "react";

export default function ProblemLine({ children, warn = false, className = "" }: {
  /** What went wrong; nothing: no line. */
  children?: ReactNode;
  warn?: boolean;
  /** Its place in its line, never its look. */
  className?: string;
}) {
  if (children === null || children === undefined || children === false || children === "") return null;
  return (
    <div className={`problem-line${warn ? " warn" : ""}${className ? ` ${className}` : ""}`} role={warn ? "status" : "alert"}>
      {children}
    </div>
  );
}
