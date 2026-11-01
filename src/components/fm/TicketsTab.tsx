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
import { useEffect, useMemo, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import { useCardRoom, useDeviceIdentity } from "@/config/VillaModel";
import { useFmData } from "@/fm/FmDataContext";
import { useHA } from "@/ha/HAStateStore";
import { closedTickets, closedTicketStats, faultBegan, faultTitle, keptDays, STAGE_WORDS, stageOf, type FmRetention } from "@/fm/fmEngine";
import { pillClass } from "@/fm/tone";
import { closedActions, helpAsked, openCounts, ticketActions, ticketCards, workRecord, type DeviceWork } from "@/fm/deviceWork";
import type { FmTicket } from "@/fm/fmTypes";
import RecordCard, { DeviceChip, Pill, type RecordCardProps } from "./RecordCard";
import FaultForm from "./FaultForm";
import { useListEditor } from "./ListEditor";
import type { DeviceOption } from "./DeviceSearchPicker";
import { faultLatest, faultNoteLines } from "@/fm/faultNotes";
import { checkPill } from "@/fm/faultTiming";
import { SourceIcons } from "./sourceIcons";
import { faultSource } from "@/fm/issueSource";
import { useAgent } from "@/agent/AgentContext";
import { useNow } from "@/hooks/useInterval";
import WorkButtons, { useCardWork } from "./WorkButtons";
import FoldedList from "@/components/common/FoldedList";
import { useFmTerms } from "@/fm/useFmTerms";
import { formatMoney } from "@/utils/money";
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
  const roomOf = useCardRoom();
  const terms = useFmTerms();
  const { deviceOfRecord } = useDeviceIdentity();
  const label = useEntityLabel();
  const { entities } = useHA();
  /** Every card's buttons carried out: Done's form, Need help, Close's question, Reopen's form (WorkButtons). */
  const work = useCardWork();
  const cadence = useAgent().status?.cadence ?? null;
  const now = useNow(60_000);

  // in progress: the cards below, one per device (openCounts) — the other figures are per record (a repair's time)
  const inProgress = openCounts(data.tickets, deviceOfRecord).tickets;
  const tickets = useMemo(() => ticketCards(data.tickets, deviceOfRecord), [data.tickets, deviceOfRecord]);
  // ⚠️ THE CLOSED ONES ARE A SECTION OF THEIR OWN, FOLDED AND PAGED (owner, 2026-10-14): the VESTA Agent clears several
  // a day. Latest closed first; the server drops them after their retention window (supervisor-proxy _fm_expire).
  // ...THE TICKETS', NOT EVERY RECORD'S (owner, 2026-11-01): a fault the VESTA Agent cleared with nobody taking it on was
  // never a ticket, nor a ticket reopened and closed as a fault (fmEngine.closedTickets) — its figures above are the
  // tickets' too (closedTicketStats)
  const closed = useMemo(() => closedTickets(data.tickets), [data.tickets]);
  // the record open as its form, among the records this tab lists (ListEditor): reopened by VESTA, erased on another
  // tablet, it leaves the list and its form closes
  const listed = useMemo(() => [...tickets.flatMap((g) => g.records), ...closed].map((t) => t.id), [tickets, closed]);
  const editor = useListEditor(listed);
  useEffect(() => {
    if (!editTicket) return;
    editor.edit(editTicket);
    onEditOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTicket]);

  /** One record, as every Facility card is drawn (RecordCard): its title, when/where/who, its notes, photos and
   *  reports, the cost of the work that resolved it. Tapping it edits it. */
  const record = (t: FmTicket, status?: RecordCardProps["status"], actions?: ReactNode, framed = true) => {
    // ⚠️ AN EDIT TAKES ITS CARD'S PLACE (owner, 2026-11-01: tapping a ticket opened a second card, its form, at the
    // top of the tab, out of view); the form brings itself into view (FmForm), and closes when its record leaves the
    // list (ListEditor)
    return editor.inPlace(t.id, card(t, status, actions, framed),
      () => <FaultForm editing={t} deviceOptions={deviceOptions} onDone={editor.close} />);
  };

  const card = (t: FmTicket, status?: RecordCardProps["status"], actions?: ReactNode, framed = true) => {
    const work = data.completions.find((c) => c.ticketId === t.id && c.costId);
    const cost = work ? data.costs.find((c) => c.id === work.costId) : undefined;
    const latest = faultLatest(t, momentText);
    return (
      <RecordCard key={t.id} framed={framed} title={faultTitle(t)} status={status} actions={actions}
        // where it comes from, the icon its Inbox card leads with (owner, 2026-11-01, the audit)
        lead={<SourceIcons sources={[faultSource(t)]} severities={["warn"]} />}
        // a ticket in progress is read again as its Inbox card is; a closed one is not
        check={stageOf(t) === "ticket" ? checkPill([{ source: faultSource(t), check: t.check }], cadence, new Date(now)) ?? undefined : undefined}
        when={momentText(faultBegan(t))} notes={faultNoteLines(t, momentText)} photoIds={t.photoIds}
        documentIds={t.documentIds} amount={cost ? formatMoney(cost.amountIdr, terms.currency) : undefined}
        erase={{ title: "Erase this ticket", detail: t.title, run: (token) => removeTicket(t.id, token) }}
        onOpen={() => editor.edit(t.id)}
        // its device's room now, the stored one only with no device (owner, 2026-10-30: devicePlace.recordRoomNow)
        room={roomOf(t)}
        pills={<>
          {/* a guest reports a symptom from inside the villa, not a diagnosis */}
          {t.reportedBy === "guest" && <span className="fm-clause guest">guest report</span>}
          {/* its device's name as its Inbox card says it (attention.cardDevice), the stored one with no device there */}
          <DeviceChip entityId={t.entityId} onOpenEntity={onOpenEntity}
            label={t.entityId && t.entityId in entities ? label(deviceOfRecord(t.entityId)) : t.deviceLabel ?? (t.entityId ? label(t.entityId) : undefined)} />
          {latest && <Pill text={latest} />}
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

      {tickets.length === 0 && (
        // THE Cockpit card, as every other (owner, 2026-10-22)
        <RecordCard lead={<Wrench size={16} className="muted" aria-hidden="true" />} title={<span className="with-tip">
          No ticket in progress
          <InfoTip label="About tickets">A fault in Inbox › Open issues becomes a ticket only when you press Open Ticket on its card.</InfoTip>
        </span>} />
      )}
      {tickets.length > 0 && <div className="fm-list">{tickets.map(ticket)}</div>}

      <FoldedList title="Closed" rows={closed} unit="closed ticket">
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
  // the closed TICKETS' figures, each timed from its Open Ticket (owner, 2026-11-01), never every closed fault's
  const stats = closedTicketStats(tickets, days === null ? undefined : { start: now - days * DAY_MS, end: now + 1 });
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
