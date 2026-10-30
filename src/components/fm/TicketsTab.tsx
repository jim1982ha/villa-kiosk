// src/components/fm/TicketsTab.tsx
// The TICKETS: the work someone took on (owner, 2026-10-14). A fault — opened by the VESTA Agent or raised by a
// person — waits in Messages' Open issues; "Open ticket" there makes it a ticket, and the ticket lives here until
// it is resolved or closed. So this tab holds the tickets in progress (one per device) and the Closed section; raising
// a fault moved to the Overview, beside the problems it is raised about. It was the Faults tab, a second list of the
// same open faults the Overview already showed.
//
// Time-to-resolution is what evidences supervision, so the app stamps the resolution time itself.

import { momentText } from "@/utils/dateText";
import InfoTip from "@/components/common/InfoTip";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useDeviceIdentity, useRecordRoom } from "@/config/VillaModel";
import { useFmData } from "@/fm/FmDataContext";
import { faultTitle, keptDays, STAGE_WORDS, stageOf, ticketStats, type FmRetention } from "@/fm/fmEngine";
import { pillClass } from "@/fm/tone";
import { closedActions, helpAsked, openCounts, ticketActions, ticketCards, workRecord, type DeviceWork } from "@/fm/deviceWork";
import type { FmTicket } from "@/fm/fmTypes";
import RecordCard, { type RecordCardProps } from "./RecordCard";
import FaultForm from "./FaultForm";
import type { DeviceOption } from "./DeviceSearchPicker";
import AgentMark from "./AgentMark";
import { faultNoteLines, faultWhen } from "@/fm/faultNotes";
import WorkButtons, { useCardWork } from "./WorkButtons";
import FoldedList from "@/components/common/FoldedList";
import { useFmTerms } from "@/fm/useFmTerms";
import { formatMoney } from "@/utils/money";
import Tip from "@/components/common/Tip";
import { DAY_MS } from "@/utils/localDay";
import { fmtDuration } from "@/components/panels/chartUtils";

export default function TicketsTab({ onOpenEntity, deviceOptions, editTicket, onEditOpened }: {
  onOpenEntity: (id: string) => void;
  /** The villa's real devices, built once by FacilitySections (the edit form's picker). */
  deviceOptions: DeviceOption[];
  /** Open this record's edit form (an open issue's "Edit ticket"); dropped once the form has it. */
  editTicket?: string;
  onEditOpened?: () => void;
}) {
  const { data, retention, removeTicket } = useFmData();
  const roomOf = useRecordRoom();
  const terms = useFmTerms();
  const { deviceOfRecord } = useDeviceIdentity();
  const label = useEntityLabel();
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Every card's buttons carried out: Done's form, Need help, Close's question, Reopen's form (WorkButtons). */
  const work = useCardWork();

  useEffect(() => {
    if (!editTicket) return;
    setEditingId(editTicket);
    onEditOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTicket]);

  // in progress: the cards below, one per device (openCounts) — the other figures are per record (a repair's time)
  const inProgress = openCounts(data.tickets, deviceOfRecord).tickets;
  const tickets = useMemo(() => ticketCards(data.tickets, deviceOfRecord), [data.tickets, deviceOfRecord]);
  // ⚠️ THE CLOSED ONES ARE A SECTION OF THEIR OWN, FOLDED AND PAGED (owner, 2026-10-14): the VESTA Agent clears several
  // a day. Latest closed first; the server drops them after their retention window (supervisor-proxy _fm_expire).
  const closed = useMemo(() => data.tickets.filter((t) => stageOf(t) === "closed")
    .sort((a, b) => Date.parse(b.resolvedAt ?? b.openedAt) - Date.parse(a.resolvedAt ?? a.openedAt)), [data.tickets]);
  const editing = editingId ? data.tickets.find((t) => t.id === editingId) : undefined;

  /** One record, as every Facility card is drawn (RecordCard): its title, when/where/who, its notes, photos and
   *  reports, the cost of the work that resolved it. Tapping it edits it. */
  const record = (t: FmTicket, status?: RecordCardProps["status"], actions?: ReactNode, framed = true) => {
    const work = data.completions.find((c) => c.ticketId === t.id && c.costId);
    const cost = work ? data.costs.find((c) => c.id === work.costId) : undefined;
    return (
      <RecordCard key={t.id} framed={framed} title={faultTitle(t)} status={status} actions={actions}
        when={faultWhen(t, momentText)} notes={faultNoteLines(t, momentText)} photoIds={t.photoIds}
        documentIds={t.documentIds} amount={cost ? formatMoney(cost.amountIdr, terms.currency) : undefined}
        erase={{ title: "Erase this record", detail: t.title, run: (token) => removeTicket(t.id, token) }}
        onOpen={() => setEditingId(t.id)}
        pills={<>
          {/* its device's room now, the stored one only with no device (owner, 2026-10-30: devicePlace.recordRoomNow) */}
          {roomOf(t) && <span className="fm-clause">{roomOf(t)}</span>}
          {/* a guest reports a symptom from inside the villa, not a diagnosis */}
          {t.reportedBy === "guest" && <span className="fm-clause guest">guest report</span>}
          <AgentMark record={t} />
          {t.entityId ? (
            <Tip text={t.entityId}>
              <button className="fm-entity-chip"
                onClick={(e) => { e.stopPropagation(); onOpenEntity(t.entityId!); }}>
                {t.deviceLabel ?? label(t.entityId)}
              </button>
            </Tip>
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
    const records = g.records.map(workRecord);
    return (
      <div key={g.key} className="fm-record-card">
        <div className="fm-ticket-records">
          {g.records.map((t, i) => record(t, i === 0 ? stagePill(t) : undefined,
            i === 0 ? <WorkButtons actions={ticketActions(records)} cardKey={g.key} work={work}
              asked={helpAsked(records)} /> : undefined, false))}
        </div>
      </div>
    );
  };

  return (
    <div className="fm-stack">
      <TicketFigures tickets={data.tickets} inProgress={inProgress} retention={retention} />

      {editing && <FaultForm key={editing.id} editing={editing} deviceOptions={deviceOptions} onDone={() => setEditingId(null)} />}

      {tickets.length === 0 && !editing && (
        // THE Cockpit card, as every other (owner, 2026-10-22)
        <RecordCard lead={<Wrench size={16} className="muted" aria-hidden="true" />} title={<span className="with-tip">
          No ticket in progress
          <InfoTip label="About tickets">A fault in Messages becomes a ticket when you press Open Ticket on its card.</InfoTip>
        </span>} />
      )}
      {tickets.length > 0 && <div className="fm-list">{tickets.map(ticket)}</div>}

      <FoldedList title="Closed" rows={closed} unit="closed record">
        {(t) => (
          // reopened, it is a fault again: back in Open issues (the VESTA Agent reads it, never guesses)
          record(t, stagePill(t),
            <WorkButtons actions={closedActions(workRecord(t))} cardKey={`closed:${t.id}`} work={work} />)
        )}
      </FoldedList>

    </div>
  );
}

/**
 * The tab's figures — in progress, the mean resolution, the closes with no action — and the period they cover.
 *
 * ⚠️ THE PERIOD IS THE RECORD THE SERVER STILL KEEPS (architecture review, 2026-10-19): it drops a no-action close after
 * its window and a repair after the evidence window (supervisor-proxy _fm_expire), so a figure over "everything" was a
 * figure over whatever had not expired yet. Counted over the shorter of the two windows the server PUBLISHES with the
 * record (fmEngine.keptDays), and named under the figures. Drawn by tests/oracles/facility_numbers.mjs.
 */
export function TicketFigures({ tickets, inProgress, retention, now = Date.now() }: {
  tickets: readonly FmTicket[];
  /** Tickets in progress, one per device (deviceWork.openCounts). */
  inProgress: number;
  /** The server's retention windows (FmDataContext.retention); null: not said, the figures cover what is held. */
  retention: FmRetention | null;
  now?: number;
}) {
  const days = retention ? keptDays(retention) : null;
  const stats = ticketStats(tickets, days === null ? undefined : { start: now - days * DAY_MS, end: now + 1 });
  return (
    <div className="fm-stack">
      <div className="fm-summary">
        <div className="fm-stat"><span className="n">{inProgress}</span><span className="l">in progress</span></div>
        <div className="fm-stat">
          <span className="n">{stats.meanResolutionHours === null ? "—" : fmtDuration(stats.meanResolutionHours * 3_600_000)}</span>
          <span className="l">mean resolution</span>
        </div>
        {/* closes with no work done, apart from the repairs (review 31: they made the mean say 4.5 h for a 48 h repair) */}
        {stats.closedWithoutAction > 0 && (
          <div className="fm-stat"><span className="n">{stats.closedWithoutAction}</span><span className="l">closed, no action</span></div>
        )}
      </div>
      {/* the figures' period, said as data in a few words (owner, 2026-10-22: no visible description text) */}
      <p className="muted fm-row-sub">Over the kept record{days === null ? "" : ` (${days} days)`}.</p>
    </div>
  );
}
