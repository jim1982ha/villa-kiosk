// src/components/fm/TicketsTab.tsx
// The TICKETS: the work someone took on (owner, 2026-10-14). A fault — opened by the VESTA Agent or raised by a
// person — waits in Messages' Open issues; "Open ticket" there makes it a ticket, and the ticket lives here until
// it is resolved or closed. So this tab holds the tickets in progress (one per device) and the Closed section. It was
// the Faults tab, a second list of the same open faults the Overview already showed.
//
// ⚠️ A NEW TICKET IS OPENED HERE (owner, 2026-11-02: "it makes no sense to see the dedicated button in the Inbox page";
// it sat on the Inbox's filters' line from 2026-10-31): the tab's own Open Ticket, a device window's wrench and an Inbox
// card's Open Ticket for a device with no record all open this one form (FaultForm), which saves a ticket in progress.
//
// Time-to-resolution is what evidences supervision, so the app stamps the resolution time itself.

import { momentText } from "@/utils/dateText";
import InfoTip from "@/components/common/InfoTip";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { useConfig } from "@/config/ConfigContext";
import { recordDevicePill } from "@/config/attention";
import { useCardRoom, useDeviceIdentity } from "@/config/VillaModel";
import { useFmData } from "@/fm/FmDataContext";
import { useHA } from "@/ha/HAStateStore";
import { closedTickets, faultAlertLabel, faultBegan, faultName, STAGE_WORDS, stageOf } from "@/fm/fmEngine";
import { closedActions, helpAsked, ticketActions, ticketCards, workRecord, type DeviceWork } from "@/fm/deviceWork";
import type { FmTicket } from "@/fm/fmTypes";
import RecordCard, { DeviceChip, RecordGroup, type RecordCardProps } from "./RecordCard";
import FaultForm from "./FaultForm";
import { useListEditor } from "./ListEditor";
import type { DeviceOption } from "./DeviceSearchPicker";
import { faultMove, faultNoteLines, moveState, moveWho, stagePillClass } from "@/fm/faultNotes";
import { closedTold } from "@/fm/faultConfirm";
import { SourceIcons } from "./sourceIcons";
import { faultSource } from "@/fm/issueSource";
import WorkButtons, { CARD_BUTTON, WorkLabel, useCardWork } from "./WorkButtons";
import FoldedList from "@/components/common/FoldedList";
import { useFmTerms } from "@/fm/useFmTerms";
import { formatMoney } from "@/utils/money";

export default function TicketsTab({ onOpenEntity, deviceOptions, editTicket, onEditOpened, raiseFor, onRaiseOpened }: {
  onOpenEntity: (id: string) => void;
  /** The villa's real devices, built once by FacilitySections (the edit form's picker). */
  deviceOptions: DeviceOption[];
  /** Open this record's edit form (an open issue's "Edit ticket"); dropped once the form has it. */
  editTicket?: string;
  onEditOpened?: () => void;
  /** Open "Open a ticket" pointed at this device (a device's wrench, an Inbox card's Open Ticket); dropped once the form
   *  has it. */
  raiseFor?: string;
  onRaiseOpened?: () => void;
}) {
  const { data, removeTicket } = useFmData();
  const roomOf = useCardRoom();
  const terms = useFmTerms();
  const { deviceOf, deviceOfRecord } = useDeviceIdentity();
  const { config, resolvedRooms } = useConfig();
  const { entities } = useHA();
  /** Every card's buttons carried out: Done's form, Need help, Close's question, Reopen's form (WorkButtons). */
  const work = useCardWork();

  const tickets = useMemo(() => ticketCards(data.tickets, deviceOfRecord), [data.tickets, deviceOfRecord]);
  // ⚠️ THE CLOSED ONES ARE A SECTION OF THEIR OWN, FOLDED AND PAGED (owner, 2026-10-14): the VESTA Agent clears several
  // a day. Latest closed first; the server drops them after their retention window (supervisor-proxy _fm_expire).
  // ...THE TICKETS', NOT EVERY RECORD'S (owner, 2026-11-01): a fault the VESTA Agent cleared with nobody taking it on was
  // never a ticket, nor a ticket reopened and closed as a fault (fmEngine.closedTickets)
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
  /** The "Open a ticket" form, above the tickets: closed, or open (pointed at a device when one was named). */
  const [raising, setRaising] = useState<{ entity?: string } | null>(null);
  useEffect(() => {
    if (!raiseFor) return;
    setRaising({ entity: raiseFor });
    onRaiseOpened?.();
    // once per request: the form keeps what was typed while the rest re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raiseFor]);

  /** One record, as every Facility card is drawn (RecordCard): its title, when/where/who, its notes, photos and
   *  reports, the cost of the work that resolved it. Tapping it edits it. */
  const record = (t: FmTicket, status?: RecordCardProps["status"], actions?: ReactNode, framed = true, stated = true) => {
    // ⚠️ AN EDIT TAKES ITS CARD'S PLACE (owner, 2026-11-01: tapping a ticket opened a second card, its form, at the
    // top of the tab, out of view); the form brings itself into view (FmForm), and closes when its record leaves the
    // list (ListEditor)
    return editor.inPlace(t.id, card(t, status, actions, framed, stated),
      () => <FaultForm editing={t} deviceOptions={deviceOptions} onDone={editor.close} />);
  };

  /** `stated`: the record says its state (its pill); false for a ticket's records after its first, whose card says it once. */
  const card = (t: FmTicket, status?: RecordCardProps["status"], actions?: ReactNode, framed = true, stated = true) => {
    const work = data.completions.find((c) => c.ticketId === t.id && c.costId);
    const cost = work ? data.costs.find((c) => c.id === work.costId) : undefined;
    const move = faultMove(t);
    const pill = recordDevicePill(t, { devices: { deviceOf }, entityMap: config.entityMap, entities, resolvedRooms });
    const when = momentText(faultBegan(t));
    // ⚠️ ITS STAGE IN ITS STRIP, WHO MOVED IT UNDER ITS WORDS (owner, 2026-11-05, the "Status on top" card): "Ticket in
    // progress" on top, "Opened by Wayan" below, never the stage or the time twice (faultNotes.moveState, moveWho)
    const state = stated ? moveState(move) ?? status : undefined;
    const said = [state ?? []].flat().map((s) => s.text);
    return (
      <RecordCard key={t.id} framed={framed} title={faultName(t)} status={state} actions={actions}
        // its alert's name, the chip of its strip as on its Inbox card (architecture review, 2026-11-05)
        number={faultAlertLabel(t)}
        who={stated ? moveWho(move, said, when, momentText) : null}
        // where it comes from, the icon its Inbox card leads with (owner, 2026-11-01, the audit)
        lead={<SourceIcons sources={[faultSource(t)]} severities={["warn"]} />}
        // ⚠️ NO "NEXT CHECK" ON A TICKET (owner, 2026-11-05: a person is on it; the Inbox card of its fault says when
        // VESTA looks again)
        when={when} notes={faultNoteLines(t, momentText)} photoIds={t.photoIds}
        pages={t.documentIds?.map((id, i, all) => (all.length > 1 ? { id, label: `Investigation report ${i + 1}`, short: `Report ${i + 1}` }
          : { id, label: "Investigation report", short: "Report" }))}
        amount={cost ? formatMoney(cost.amountIdr, terms.currency) : undefined}
        erase={{ title: "Erase this ticket", detail: t.title, run: (token) => removeTicket(t.id, token) }}
        onOpen={() => editor.edit(t.id)}
        // its device's room now, the stored one only with no device (owner, 2026-10-30: devicePlace.recordRoomNow)
        room={roomOf(t)}
        // its device's name and what a tap opens as its Inbox card has them (attention.recordDevicePill), first on its line
        device={<DeviceChip entityId={pill.opens} onOpenEntity={onOpenEntity} label={pill.label} />}
        // a guest reports a symptom from inside the villa, not a diagnosis
        pills={t.reportedBy === "guest" ? <span className="fm-clause guest">guest report</span> : undefined} />
    );
  };

  /** A record's status pill: its stage's one word and tone (fmEngine.STAGE_WORDS — the recap's word too). */
  const stagePill = (t: FmTicket) => {
    const s = STAGE_WORDS[stageOf(t)];
    return { text: s.card, tone: stagePillClass(stageOf(t)) };
  };

  /** A ticket in progress: ONE card — every record taken on with it, its pill on the first, its buttons inside at the
   *  bottom (owner, 2026-10-14: the device's name above it said again what its chip says; the pill and the buttons sat
   *  outside the card).
   *
   *  ⚠️ ONE PILL PER CARD (owner, 2026-11-03, "A": the Outdoor Entrance Lock's card held VESTA's alert and the night
   *  check's finding, opened as a ticket by one press, and both said "Ticket opened by Owner … In progress" while the
   *  tab's count, one per device, said 1): the first record says the card's state, the others do not repeat it. */
  const ticket = (g: DeviceWork) => {
    const records = g.records.map(workRecord);
    const buttons = <WorkButtons actions={ticketActions(records)} cardKey={g.key} work={work} asked={helpAsked(records)} />;
    if (g.records.length === 1) return <Fragment key={g.key}>{record(g.records[0], stagePill(g.records[0]), buttons)}</Fragment>;
    // several records of one device: one frame, its buttons its last part, under every record (RecordCard rule 6)
    return (
      <RecordGroup key={g.key} actions={buttons}>
        {g.records.map((t, i) => record(t, i === 0 ? stagePill(t) : undefined, undefined, false, i === 0))}
      </RecordGroup>
    );
  };

  return (
    <div className="fm-stack">
      {/* the tab's own button, at the right of its first line, in the cards' words and wrench (WorkLabel) */}
      <div className="tickets-toolbar">
        <button type="button" className={CARD_BUTTON} onClick={() => setRaising({})}><WorkLabel kind="raiseTicket" /></button>
      </div>
      {raising && (
        <FaultForm key={raising.entity ?? "new"} presetEntity={raising.entity} deviceOptions={deviceOptions}
          onDone={() => setRaising(null)} />
      )}

      {tickets.length === 0 && (
        // THE Cockpit card, as every other (owner, 2026-10-22)
        <RecordCard lead={<Wrench size={16} className="muted" aria-hidden="true" />} title={<span className="with-tip">
          No ticket in progress
          <InfoTip label="About tickets">A fault in Inbox › Open issues becomes a ticket only when you press Open Ticket on its card.</InfoTip>
        </span>} />
      )}
      {tickets.length > 0 && <div className="fm-list">{tickets.map(ticket)}</div>}

      <FoldedList title="Closed" rows={closed} empty="No ticket closed yet."
        tip="Finished tickets, the latest closed first. A ticket reopened is a fault again, in Inbox › Open issues.">
        {(t) => (
          // reopened, it is a fault again: back in Open issues (the VESTA Agent reads it, never guesses)
          record(t, stagePill(t),
            <WorkButtons actions={closedActions(workRecord(t), closedTold(t).reopen)} cardKey={`closed:${t.id}`} work={work} />)
        )}
      </FoldedList>

    </div>
  );
}
