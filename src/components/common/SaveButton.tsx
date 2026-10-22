// src/components/common/SaveButton.tsx
// "Save …" that reads "Saved" for a moment after it worked — the Facility
// report, readiness snapshot and spend statement each wrote this ternary
// (2.496.199). The caller keeps its own `saved` flag (it is set only when the
// store confirms the write — see FmWriteResult).

import type { CSSProperties, ReactNode } from "react";
import { Download, Save } from "lucide-react";

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

/**
 * A generated document's Save and Download .md (the Cockpit's recap and spend statement) — shown ONLY when there is a
 * document for the period to save or download, never greyed out beside nothing (owner, 2026-10-22). Nothing generated
 * (`markdown` empty): nothing drawn.
 */
export function DocumentButtons({ markdown, saved, saveLabel, onSave, onDownload }: {
  markdown: string | null | undefined;
  saved: boolean;
  saveLabel: string;
  onSave: () => void;
  onDownload: () => void;
}) {
  if (!markdown) return null;
  return (
    <>
      <SaveButton saved={saved} label={saveLabel} icon={<Save size={16} />} onClick={onSave} />
      <button className="btn ghost" onClick={onDownload}>
        <Download size={16} /> Download .md
      </button>
    </>
  );
}
