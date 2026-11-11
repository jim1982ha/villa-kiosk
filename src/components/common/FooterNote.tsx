// src/components/common/FooterNote.tsx
// What a window says just above its footer, on the footer's own background, a plain line each (common/ProblemLine):
// why its answer was refused (red), or what became of a change already made (amber: another device replaced it, it
// is kept on this device alone). A note that stays until read has its ✕.
//
// ⚠️ ONE BAND (owner, 2026-11-10: one definition): a refused Save was amber words squeezed beside the footer's
// buttons, a refused ticket a red line with its own margins, the question box's a red line under its field, and
// "replaced on another device" this band, written twice.

import type { ReactNode } from "react";
import { X } from "lucide-react";
import IconButton from "./IconButton";
import ProblemLine from "./ProblemLine";

export default function FooterNote({ lines, warn = false, onDismiss }: {
  lines: readonly ReactNode[];
  warn?: boolean;
  onDismiss?: () => void;
}) {
  const said = lines.filter((l) => l !== null && l !== undefined && l !== false && l !== "");
  if (said.length === 0) return null;
  return (
    <div className="modal-footer-note">
      <div className="modal-footer-note-lines">
        {said.map((l, n) => <ProblemLine key={n} warn={warn}>{l}</ProblemLine>)}
      </div>
      {onDismiss && <IconButton small label="Dismiss" onClick={onDismiss}><X size={16} aria-hidden /></IconButton>}
    </div>
  );
}
