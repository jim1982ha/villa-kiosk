// src/components/fm/TicketsTab.tsx
// The TICKETS: the work someone took on (owner, 2026-10-14). A fault — opened by the VESTA Agent or raised by a
// person — waits on the Overview's list; "Open ticket" there makes it a ticket, and the ticket lives here until
// it is resolved or closed. So this tab holds the tickets in progress (one per device) and the Closed section; raising
// a fault moved to the Overview, beside the problems it is raised about. It was the Faults tab, a second list of the
// same open faults the Overview already showed.
//
// Time-to-resolution is what evidences supervision, so the app stamps the resolution time itself.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useDeviceIdentity } from "@/config/VillaModel";
import { useFmData } from "@/fm/FmDataContext";
import { faultTitle, localStamp, STAGE_WORDS, stageOf, ticketStats } from "@/fm/fmEngine";
import { pillClass } from "@/fm/tone";
import { closedActions, openCounts, ticketActions, ticketCards, workRecord, type DeviceWork, type WorkAction } from "@/fm/deviceWork";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import RecordCard, { type RecordCardProps } from "./RecordCard";
import FaultStageModal from "./FaultStageModal";
import FaultForm from "./FaultForm";
import type { DeviceOption } from "./DeviceSearchPicker";
import AgentMark from "./AgentMark";
import { faultNoteLines, faultWhen } from "@/fm/faultNotes";
import WorkButtons, { useConfirmedClose } from "./WorkButtons";
import FoldedList from "@/components/common/FoldedList";
import { useFmTerms } from "@/fm/useFmTerms";
import { formatMoney } from "@/utils/money";
import { cleanRoom } from "@/config/devicePlace";

export default function TicketsTab({ onOpenEntity, deviceOptions, editTicket, onEditOpened }: {
  onOpenEntity: (id: string) => void;
  /** The villa's real devices, built once by FacilitySections (the edit form's picker). */
  deviceOptions: DeviceOption[];
  /** Open this record's edit form (the Overview card's "Edit ticket"); dropped once the form has it. */
  editTicket?: string;
  onEditOpened?: () => void;
}) {
  const { data, removeTicket } = useFmData();
  const terms = useFmTerms();
  const { deviceOfRecord } = useDeviceIdentity();
  const label = useEntityLabel();
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The ticket whose stage change is being recorded, and where it goes. */
  const [staging, setStaging] = useState<{ tickets: FmTicket[]; to: FmTicketStatus } | null>(null);
  /** The ticket whose one-step close ("nothing done") is being confirmed, and why the last one did not land. */
  const closer = useConfirmedClose();

  useEffect(() => {
    if (!editTicket) return;
    setEditingId(editTicket);
    onEditOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTicket]);

  const stats = ticketStats(data.tickets);
  // in progress: the cards below, one per device (openCounts) — the other figures are per record (a repair's time)
  const inProgress = openCounts(data.tickets, deviceOfRecord).tickets;
  const tickets = useMemo(() => ticketCards(data.tickets, deviceOfRecord), [data.tickets, deviceOfRecord]);
  // ⚠️ THE CLOSED ONES ARE A SECTION OF THEIR OWN, FOLDED AND PAGED (owner, 2026-10-14): the VESTA Agent clears several
  // a day. Latest closed first; the server drops them after their retention window (supervisor-proxy _fm_expire).
  const closed = useMemo(() => data.tickets.filter((t) => stageOf(t) === "closed")
    .sort((a, b) => Date.parse(b.resolvedAt ?? b.openedAt) - Date.parse(a.resolvedAt ?? a.openedAt)), [data.tickets]);
  const editing = editingId ? data.tickets.find((t) => t.id === editingId) : undefined;

  /** A button that is not a Close (deviceWork): Mark resolved, Reopen — the stage change, recorded in its form. */
  const onAction = (a: WorkAction) => {
    if (a.step.kind !== "stage") return;
    setStaging({ tickets: a.ids.map((id) => data.tickets.find((t) => t.id === id)).filter((t): t is FmTicket => !!t), to: a.step.to });
  };

  /** One record, as every Facility card is drawn (RecordCard): its title, when/where/who, its notes, photos and
   *  reports, the cost of the work that resolved it. Tapping it edits it. */
  const record = (t: FmTicket, status?: RecordCardProps["status"], actions?: ReactNode, framed = true) => {
    const work = data.completions.find((c) => c.ticketId === t.id && c.costId);
    const cost = work ? data.costs.find((c) => c.id === work.costId) : undefined;
    return (
      <RecordCard key={t.id} framed={framed} title={faultTitle(t)} status={status} actions={actions}
        when={faultWhen(t, localStamp)} notes={faultNoteLines(t, localStamp)} photoIds={t.photoIds}
        documentIds={t.documentIds} amount={cost ? formatMoney(cost.amountIdr, terms.currency) : undefined}
        erase={{ title: "Erase this record", detail: t.title, run: (token) => removeTicket(t.id, token) }}
        onOpen={() => setEditingId(t.id)}
        pills={<>
          {/* the room stored on the ticket when it was opened (never re-resolved), cleaned as every room is */}
          {cleanRoom(t.room) && <span className="fm-clause">{cleanRoom(t.room)}</span>}
          {/* a guest reports a symptom from inside the villa, not a diagnosis */}
          {t.reportedBy === "guest" && <span className="fm-clause guest">guest report</span>}
          <AgentMark record={t} />
          {t.entityId ? (
            <button className="fm-entity-chip" title={t.entityId}
              onClick={(e) => { e.stopPropagation(); onOpenEntity(t.entityId!); }}>
              {t.deviceLabel ?? label(t.entityId)}
            </button>
          ) : t.deviceLabel ? <span className="fm-entity-chip" style={{ cursor: "default" }}>{t.deviceLabel}</span> : null}
        </>} />
    );
  };

  /** A record's status pill: its stage's one word and tone (fmEngine.STAGE_WORDS — the recap's word too). */
  const stagePill = (t: FmTicket) => {
    const s = STAGE_WORDS[stageOf(t)];
    return { text: s.word, tone: pillClass(s.tone) };
  };

  /** A ticket in progress: ONE card — every record taken on with it, its pill on the first, its buttons inside at the
   *  bottom (owner, 2026-10-14: the device's name above it said again what its chip says; the pill and the buttons sat
   *  outside the card). */
  const ticket = (g: DeviceWork) => {
    const problem = closer.problemFor(g.key);
    return (
      <div key={g.key} className="fm-record-card">
        <div className="fm-ticket-records">
          {g.records.map((t, i) => record(t, i === 0 ? stagePill(t) : undefined,
            i === 0 ? <WorkButtons actions={ticketActions(g.records.map(workRecord))} cardKey={g.key} closer={closer}
              onAction={onAction} /> : undefined, false))}
        </div>
        {problem && <div className="fm-inline-error fm-row-confirm" role="alert">{problem}</div>}
      </div>
    );
  };

  return (
    <div className="fm-stack">
      <div className="fm-summary">
        <div className="fm-stat"><span className="n">{inProgress}</span><span className="l">in progress</span></div>
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
          // reopened, it is a fault again: back on the Overview's list (the VESTA Agent reads it, never guesses)
          record(t, stagePill(t),
            <WorkButtons actions={closedActions(workRecord(t))} cardKey={`closed:${t.id}`} closer={closer} onAction={onAction} />)
        )}
      </FoldedList>

      {staging && <FaultStageModal tickets={staging.tickets} to={staging.to} onClose={() => setStaging(null)} />}
    </div>
  );
}
