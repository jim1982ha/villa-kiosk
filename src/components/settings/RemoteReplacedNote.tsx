// src/components/settings/RemoteReplacedNote.tsx
// The plain line a dialog shows above its footer when another tablet replaced one of ITS OWN changes (already sent):
// "Hall light was changed on another tablet; your change was replaced." One line per device or setting, the device
// named as every screen names it; X dismisses, and closing the dialog clears it. What to say is the draft's
// (hooks/useDraftedSlice `replaced`, configSlice ledgerOnRemote); this only shows it, the same in every dialog.

import { X } from "lucide-react";
import { replacedLine, type ReplacedSubject } from "@/config/configSlice";
import { useEntityLabel } from "@/hooks/useEntityLabel";

export default function RemoteReplacedNote({ replaced, onDismiss }: {
  replaced: readonly ReplacedSubject[];
  onDismiss: () => void;
}) {
  const labelOf = useEntityLabel();
  if (replaced.length === 0) return null;
  return (
    <div className="modal-remote-note" role="status">
      <div className="modal-remote-note-lines">
        {replaced.map((s) => (
          <span key={JSON.stringify(s)} className="body-text sev-warning">{replacedLine(s, labelOf)}</span>
        ))}
      </div>
      <button className="icon-btn modal-remote-note-close" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** The same line for the dialog's own save that did not reach the store (ConfigContext `saveProblem`): refused and
 *  undone, or kept only on this device. X dismisses it; the next save that lands clears it. */
export function SaveProblemNote({ line, onDismiss }: { line: string | null; onDismiss: () => void }) {
  if (!line) return null;
  return (
    <div className="modal-remote-note" role="status">
      <div className="modal-remote-note-lines">
        <span className="body-text sev-warning">{line}</span>
      </div>
      <button className="icon-btn modal-remote-note-close" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
