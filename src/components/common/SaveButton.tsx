// src/components/common/SaveButton.tsx
// "Save …" that reads "Saved" for a moment after it worked — the Facility
// report, readiness snapshot and spend statement each wrote this ternary
// (2.496.199). The caller keeps its own `saved` flag (it is set only when the
// store confirms the write — see FmWriteResult).

import type { CSSProperties, ReactNode } from "react";

export default function SaveButton({ saved, label, icon, onClick, disabled, style }: {
  saved: boolean;
  /** The verb phrase while unsaved: "Save report". */
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button className="btn ghost" onClick={onClick} disabled={disabled || saved} style={style}>
      {icon} {saved ? "Saved" : label}
    </button>
  );
}
