// src/components/fm/TicketsTab.tsx
// The TICKETS: the work someone took on (owner, 2026-10-14). A fault — opened by the VESTA Agent or raised by a
// person — waits on the Overview's list; "Open ticket" there makes it a ticket, and the ticket lives here until
// it is resolved or closed. So this tab holds the tickets in progress (one per device) and the Closed section; raising
// a fault moved to the Overview, beside the problems it is raised about. It was the Faults tab, a second list of the
// same open faults the Overview already showed.
//
// Time-to-resolution is what evidences supervision, so the app stamps the resolution time itself.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, Wrench } from "lucide-react";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useDeviceIdentity } from "@/config/VillaModel";
import { useFmData, fmSaveOutcome } from "@/fm/FmDataContext";
import { faultTitle, localStamp, stageOf, ticketStats } from "@/fm/fmEngine";
import { ticketGroups, type TicketGroup } from "@/fm/ticketGroups";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import EvidenceRow from "./EvidenceRow";
import { documentUrl } from "@/fm/fmApi";
import ErasableRow from "./ErasableRow";
import FaultStageModal from "./FaultStageModal";
import FaultForm from "./FaultForm";
import type { DeviceOption } from "./DeviceSearchPicker";
import AgentMark from "./AgentMark";
import RecordMeta, { RecordNotes } from "./RecordMeta";
import { faultNoteLines, faultWhen } from "@/fm/faultNotes";
import InlineConfirm from "@/components/common/InlineConfirm";
import FoldedList from "@/components/common/FoldedList";

export default function TicketsTab({ onOpenEntity, deviceOptions, editTicket, onEditOpened }: {
  onOpenEntity: (id: string) => void;
  /** The villa's real devices, built once by FacilitySections (the edit form's picker). */
  deviceOptions: DeviceOption[];
  /** Open this record's edit form (the Overview card's "Edit ticket"); dropped once the form has it. */
  editTicket?: string;
  onEditOpened?: () => void;
}) {
  const { data, removeTicket, closeTickets } = useFmData();
  const { deviceOf } = useDeviceIdentity();
  const label = useEntityLabel();
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The ticket whose stage change is being recorded, and where it goes. */
  const [staging, setStaging] = useState<{ tickets: FmTicket[]; to: FmTicketStatus } | null>(null);
  /** The ticket whose one-step close ("nothing done") is being confirmed, and why the last one did not land. */
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<{ key: string; text: string } | null>(null);

  useEffect(() => {
    if (!editTicket) return;
    setEditingId(editTicket);
    onEditOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTicket]);

  const stats = ticketStats(data.tickets);
  const tickets = useMemo(() => ticketGroups(
    data.tickets.filter((t) => stageOf(t) === "ticket").sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)),
    deviceOf), [data.tickets, deviceOf]);
  // ⚠️ THE CLOSED ONES ARE A SECTION OF THEIR OWN, FOLDED AND PAGED (owner, 2026-10-14): the VESTA Agent clears several
  // a day. Latest closed first; the server drops them after their retention window (supervisor-proxy _fm_expire).
  const closed = useMemo(() => data.tickets.filter((t) => stageOf(t) === "closed")
    .sort((a, b) => Date.parse(b.resolvedAt ?? b.openedAt) - Date.parse(a.resolvedAt ?? a.openedAt)), [data.tickets]);
  const editing = editingId ? data.tickets.find((t) => t.id === editingId) : undefined;

  const closeNoAction = async (key: string, ids: string[]) => {
    setCloseError(null);
    const { done, note: why } = fmSaveOutcome(await closeTickets(ids));
    setClosingKey(null);
    if (!done && why) setCloseError({ key, text: why });
  };

  /** One record: its title (with the ticket's pill on the first one), when/where/who, its notes, photos and reports.
   *  Tapping it edits it. */
  const record = (t: FmTicket, status?: { text: string; tone: "ok" | "due-soon" }, actions?: ReactNode) => (
    <ErasableRow key={t.id} className="fm-ticket-record" intent={{ title: "Erase this record", detail: t.title }}
      erase={(token) => removeTicket(t.id, token)} onOpen={() => setEditingId(t.id)}>
      <div className="fm-fault-head">
        <div className="fm-row-title"><strong>{faultTitle(t)}</strong></div>
        {status && <span className={`fm-badge ${status.tone}`}>{status.text}</span>}
      </div>
      {/* its text on the left, the ticket's buttons on the right of it, inside the card (owner, 2026-10-14) */}
      <div className="fm-ticket-body">
        <div className="fm-row-main">
          <RecordMeta when={faultWhen(t, localStamp)}>
            {t.room && <span className="fm-clause">{t.room}</span>}
            {/* a guest reports a symptom from inside the villa, not a diagnosis */}
            {t.reportedBy === "guest" && <span className="fm-clause guest">guest report</span>}
            <AgentMark record={t} />
            {t.entityId ? (
              <button className="fm-entity-chip" title={t.entityId}
                onClick={(e) => { e.stopPropagation(); onOpenEntity(t.entityId!); }}>
                {t.deviceLabel ?? label(t.entityId)}
              </button>
            ) : t.deviceLabel ? <span className="fm-entity-chip" style={{ cursor: "default" }}>{t.deviceLabel}</span> : null}
          </RecordMeta>
          <RecordNotes notes={faultNoteLines(t, localStamp)} />
          {t.photoIds.length > 0 && <EvidenceRow photoIds={t.photoIds} disabled />}
          {/* the investigation report the VESTA Agent attached: opens on the iPad, offline */}
          {(t.documentIds?.length ?? 0) > 0 && (
            <div className="fm-documents">
              {t.documentIds!.map((id, i) => (
                <a key={id} className="fm-document-link" href={documentUrl(id)} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}>
                  <FileText size={15} aria-hidden="true" />
                  {t.documentIds!.length > 1 ? `Investigation report ${i + 1}` : "Investigation report"}
                </a>
              ))}
            </div>
          )}
        </div>
        {/* a press on a button is the button's: never the card's hold-to-erase, never its tap-to-edit */}
        {actions && <div className="fm-ticket-actions" onPointerDown={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
    </ErasableRow>
  );

  /** A ticket in progress: ONE card — every record taken on with it, its pill on the first, its buttons inside at the
   *  bottom (owner, 2026-10-14: the device's name above it said again what its chip says; the pill and the buttons sat
   *  outside the card). */
  const ticket = (g: TicketGroup) => {
    return (
      <div key={g.key} className="fm-ticket-card">
        <div className="fm-ticket-records">
          {g.records.map((t, i) => record(t, i === 0 ? { text: "In progress", tone: "due-soon" } : undefined,
            i === 0 ? (closingKey === g.key ? (
              <InlineConfirm question="Close this ticket? Nothing was done — no cost is recorded." confirmLabel="Close ticket"
                onConfirm={() => closeNoAction(g.key, g.records.map((r) => r.id))} onCancel={() => setClosingKey(null)} />
            ) : (
              <>
                <button className="btn ghost" onClick={() => setStaging({ tickets: g.records, to: "resolved" })}>Mark resolved</button>
                {/* the one-step close beside the two-step flow: "Closed without action", no completion, no cost */}
                <button className="btn ghost" onClick={() => { setCloseError(null); setClosingKey(g.key); }}>Close</button>
              </>
            )) : undefined))}
        </div>
        {closeError?.key === g.key && <div className="fm-inline-error fm-row-confirm" role="alert">{closeError.text}</div>}
      </div>
    );
  };

  return (
    <div className="fm-stack">
      <div className="fm-summary">
        <div className="fm-stat"><span className="n">{stats.inProgress}</span><span className="l">in progress</span></div>
        <div className="fm-stat">
          <span className="n">{stats.meanResolutionHours === null ? "—" : `${stats.meanResolutionHours.toFixed(0)}h`}</span>
          <span className="l">mean resolution</span>
        </div>
        {/* closes with no work done, apart from the repairs (review 31: they made the mean say 4.5 h for a 48 h repair) */}
        {stats.closedWithoutAction > 0 && (
          <div className="fm-stat"><span className="n">{stats.closedWithoutAction}</span><span className="l">closed, no action</span></div>
        )}
      </div>

      {editing && <FaultForm key={editing.id} editing={editing} deviceOptions={deviceOptions} onDone={() => setEditingId(null)} />}

      {tickets.length === 0 && !editing && (
        <div className="fm-empty">
          <Wrench size={28} />
          <h3>No ticket in progress</h3>
          <p className="muted body-text">A fault on the Overview becomes a ticket when you press Open Ticket on its card.</p>
        </div>
      )}
      {tickets.length > 0 && <div className="fm-list">{tickets.map(ticket)}</div>}

      <FoldedList title="Closed" rows={closed} unit="closed record">
        {(t) => (
          <div key={t.id} className="fm-ticket-card">
            {/* reopened, it is a fault again: back on the Overview's list (the VESTA Agent reads it, never guesses) */}
            {record(t, { text: "Resolved", tone: "ok" },
              <button className="btn ghost" onClick={() => setStaging({ tickets: [t], to: "open" })}>Reopen</button>)}
          </div>
        )}
      </FoldedList>

      {staging && <FaultStageModal tickets={staging.tickets} to={staging.to} onClose={() => setStaging(null)} />}
    </div>
  );
}
