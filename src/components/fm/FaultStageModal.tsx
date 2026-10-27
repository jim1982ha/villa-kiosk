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

import Window from "@/components/common/Window";
import { useState } from "react";

import { useFmData } from "@/fm/FmDataContext";
import { faultTitle, parseAmount } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import EvidenceRow from "./EvidenceRow";
import NotesField from "./NotesField";
import CostFields from "./CostFields";

// A fault becomes a TICKET when someone takes it on (owner, 2026-10-14): the dialog speaks of the ticket.
const STAGE_COPY: Record<FmTicketStatus, { title: string; cta: string; note: string }> = {
  open: { title: "Reopen", cta: "Reopen", note: "Why it's being reopened (optional)" },
  in_progress: {
    title: "Open a ticket", cta: "Open Ticket",
    note: "What you found / what's being done (optional)",
  },
  resolved: {
    title: "Resolve the ticket", cta: "Mark resolved",
    note: "What was done (optional)",
  },
};

export default function FaultStageModal({
  tickets, to, onClose,
}: {
  /** One device's faults (one ticket), moved together — usually one. */
  tickets: readonly FmTicket[];
  /** The status this transition moves them to. */
  to: FmTicketStatus;
  onClose: () => void;
}) {
  const { advanceTickets } = useFmData();
  const ticket = tickets[0];
  // Escape + Back + focus trap + focus restore, from ONE hook — see
  // useModalA11y. It registers useBackToClose itself, so calling both would
  // push this surface onto the dismissal stack twice.
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<"minor" | "major">("minor");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const copy = STAGE_COPY[to];
  // Cost belongs to the end of the job, not the middle of it — asking for it
  // while work is still in progress invites a guess.
  const asksCost = to === "resolved";
  const amountIdr = asksCost ? parseAmount(amount) : 0;

  const submit = async () => {
    setBusy(true);
    setFailed(null);
    const result = await advanceTickets(
      tickets.map((t) => t.id), to,
      { who: who.trim() || undefined, note: note.trim() || undefined, photoIds },
      amountIdr > 0
        ? {
            amountIdr, category,
            label: `Ticket: ${faultTitle(ticket)}`,
            note: note.trim() || undefined,
            entityId: ticket.entityId,
            deviceLabel: ticket.deviceLabel,
            room: ticket.room,
          }
        : undefined,
    );
    setBusy(false);
    // Closes when saved or queued; stays, with the reason, only when refused.
    const { done, note: why } = result;
    if (done) onClose(); else setFailed(why);
  };

  return (
    // a window about ONE device's faults fits its content, as the device's own window does (owner, 2026-10-22: "Open a
    // ticket" was the full window height)
    <Window kind="device" label={copy.title} onClose={onClose} style={{ maxWidth: 520 }}>
      <div className="modal-header">
        <h2>{copy.title}</h2>
      </div>
      <div className="modal-body fm-stack">
        {/* the fault as its card names it (fmEngine.faultTitle: "#5 · …", a duration worded now) — not the stored title */}
        {tickets.map((t) => <div key={t.id} className="fm-banner">{faultTitle(t)}</div>)}
        <label className="fm-field">
          <span>Who{asksCost ? " did the work" : "'s handling it"} (optional)</span>
          <input value={who} onChange={(e) => setWho(e.target.value)}
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
        {/* The same cost fields and cap line as the Today and Spend forms
            (CostFields) — this was once the one place without the warning. */}
        {asksCost && (
          <CostFields amount={amount} onAmount={setAmount} category={category} onCategory={setCategory} optional />
        )}
      </div>
      {failed && <div className="fm-inline-error" role="alert" style={{ margin: "0 28px 8px" }}>{failed}</div>}
      {/* The modal shell's footer, as every dialog's (04-modals.css). */}
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : copy.cta}
        </button>
      </div>
    </Window>
  );
}
