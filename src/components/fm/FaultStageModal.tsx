// src/components/fm/FaultStageModal.tsx
// Recording WHAT HAPPENED when a fault moves to its next stage.
//
// One dialog for every transition, not one per stage. Picking a fault up and
// closing it out ask the same three questions — who, what happened, and show
// me — and the only thing that differs at the end is whether money was spent.
// A separate "start work" and "resolve" dialog would be two copies of the same
// form drifting apart, and the operator would learn two layouts for one idea.
//
// What this closes:
//   * A status used to be a bare word with a timestamp. Mean-time-to-
//     resolution rested on it, but the record couldn't say who picked the
//     fault up or what they found — an assertion with a clock attached.
//   * A fault and the work that fixed it were unrelated records, so no report
//     could say "this fault, fixed on this date, at this cost". Resolving now
//     files a completion linked back to the ticket, the same shape as logging
//     scheduled work.
//
// Everything except the transition itself is optional. A dialog that BLOCKS
// progress until it is filled in gets satisfied with junk, or the fault is
// left where it is — both worse than a thin but honest record.

import { useState } from "react";
import { X } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { formatIdr } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import EvidenceRow from "./EvidenceRow";
import NotesField from "./NotesField";
import { useBackToClose } from "@/hooks/useBackToClose";

const STAGE_COPY: Record<FmTicketStatus, { title: string; cta: string; note: string }> = {
  open: { title: "Reopen fault", cta: "Reopen", note: "Why it's being reopened (optional)" },
  in_progress: {
    title: "Start work", cta: "Mark in progress",
    note: "What you found / what's being done (optional)",
  },
  resolved: {
    title: "Resolve fault", cta: "Mark resolved",
    note: "What was done (optional)",
  },
};

export default function FaultStageModal({
  ticket, to, onClose,
}: {
  ticket: FmTicket;
  /** The status this transition moves the fault to. */
  to: FmTicketStatus;
  onClose: () => void;
}) {
  const { advanceTicket } = useFmData();
  // Back closes this, never the app: only the villa map lets a press through
  // to the platform. One line per surface, from the shared hook.
  useBackToClose(onClose);
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<"minor" | "major">("minor");
  const [busy, setBusy] = useState(false);

  const copy = STAGE_COPY[to];
  // Cost belongs to the end of the job, not the middle of it — asking for it
  // while work is still in progress invites a guess.
  const asksCost = to === "resolved";
  const amountIdr = asksCost ? Number(amount.replace(/[^\d]/g, "")) || 0 : 0;

  const submit = async () => {
    setBusy(true);
    await advanceTicket(
      ticket.id, to,
      { by: by.trim() || undefined, note: note.trim() || undefined, photoIds },
      amountIdr > 0
        ? {
            amountIdr, category,
            label: `Fault: ${ticket.title}`,
            note: note.trim() || undefined,
            entityId: ticket.entityId,
            deviceLabel: ticket.deviceLabel,
            room: ticket.room,
          }
        : undefined,
    );
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2>{copy.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body fm-stack">
          <div className="fm-banner">{ticket.title}</div>
          <label className="fm-field">
            <span>Who{asksCost ? " did the work" : "'s handling it"} (optional)</span>
            <input value={by} onChange={(e) => setBy(e.target.value)}
              placeholder="e.g. Wayan / AC contractor" />
          </label>
          <NotesField
            label={copy.note}
            value={note}
            onChange={setNote}
            rows={3}
            placeholder={asksCost
              ? "e.g. Replaced the capacitor and cleaned the filters"
              : "e.g. Contractor booked for Thursday morning"}
          />
          <div className="fm-field">
            <span>Photo (optional)</span>
            {/* Kept on the FAULT as well as this step, so the before/after
                pair lives on one record instead of scattered across steps. */}
            <EvidenceRow photoIds={photoIds} onChange={setPhotoIds} />
          </div>
          {asksCost && (
            <label className="fm-field">
              <span>What it cost (optional — leave blank if nothing was spent)</span>
              <input value={amount} inputMode="numeric"
                onChange={(e) => setAmount(e.target.value)} placeholder="450000" />
            </label>
          )}
          {amountIdr > 0 && (
            <>
              <label className="fm-field">
                <span>Category</span>
                <select value={category}
                  onChange={(e) => setCategory(e.target.value as "minor" | "major")}>
                  <option value="minor">Minor — counts against the monthly cap</option>
                  <option value="major">Major — outside the cap</option>
                </select>
              </label>
              <div className="fm-row-sub muted">
                Records {formatIdr(amountIdr)} against this fault.
              </div>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : copy.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
