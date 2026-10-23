// src/components/cockpit/CockpitOverview.tsx
// The Cockpit's own view — its Overview tab: the open issues, one card per device. Split from CockpitModal
// (2.496.274), which is now only the window: its tabs, the Facility sections and the footer. The villa by room / floor
// / category and Recent activity were removed (owner, 2026-10-20): the split per room or floor lives in every device
// list (SummaryGroupPanel), and the activity feed told nothing used.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import Tip from "@/components/common/Tip";
import { useHA } from "@/ha/HAStateStore";
import { useConfig } from "@/config/ConfigContext";
import { useFmData } from "@/fm/FmDataContext";
import WorkButtons, { useConfirmedClose, type ConfirmedClose } from "@/components/fm/WorkButtons";
import type { Doors } from "@/auth/doors";
import { useVillaAttention } from "./useVillaAttention";
import type { AttentionGroup } from "@/config/attention";
import { cockpitCard, type CardLine, type CardView } from "@/config/cockpitCard";
import { SourceIcons } from "@/components/fm/sourceIcons";
import RecordCard, { CheckPill } from "@/components/fm/RecordCard";
import { useVillaModel } from "@/config/VillaModel";
import { buildDeviceOptions } from "@/components/fm/DeviceSearchPicker";
import FaultForm from "@/components/fm/FaultForm";
import FaultTiming from "@/components/fm/FaultTiming";
import { useAgent } from "@/agent/AgentContext";
import FaultStageModal from "@/components/fm/FaultStageModal";
import { localStamp } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import { confirmingCards } from "@/config/cockpitCard";
import { confirmingFaults } from "@/fm/faultConfirm";
import { useProfile } from "@/auth/ProfileContext";
import { useNow } from "@/hooks/useInterval";


export default function CockpitOverview({ onOpenEntity, doors, reportFaultFor, onFaultFormOpened, onEditTicket, onReportProblem }: {
  onOpenEntity: (entityId: string) => void;
  /** What this profile may do (auth/doors): `facility` takes faults on and opens tickets, `reportFault` reports a
   *  problem. */
  doors: Doors;
  /** "Raise a fault" opens pointed at this device (a device panel's wrench); dropped once the form has it. */
  reportFaultFor?: string;
  onFaultFormOpened?: () => void;
  /** A card's "Edit ticket": the Tickets tab, that record's form open. */
  onEditTicket: (ticketId: string) => void;
  /** A guest's "Report a problem". */
  onReportProblem: () => void;
}) {
  const { entities } = useHA();
  const { config, resolvedRooms } = useConfig();
  // Taking a fault on, closing it and raising one are Facility work: the profiles that manage it. Everyone else
  // who may report (a guest) gets "Report a problem".
  const canManage = doors.facility;
  const canReport = doors.reportFault;
  const { devices } = useVillaModel();
  const deviceOptions = useMemo(
    () => (canManage ? buildDeviceOptions(devices, config.entityMap, entities, resolvedRooms) : []),
    [canManage, devices, config.entityMap, entities, resolvedRooms]);
  /** The raise form: closed, or open (pointed at a device when it came from a device's wrench). */
  const [raising, setRaising] = useState<{ entity?: string } | null>(null);
  useEffect(() => {
    if (!reportFaultFor || !canManage) return;
    setRaising({ entity: reportFaultFor });
    onFaultFormOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportFaultFor]);

  // Shared with HUD's own top-bar alert icon/overflow-menu badge — see
  // useVillaAttention's own docstring for why that sharing is load-bearing,
  // not just tidiness (the two used to disagree).
  const { attentionGroups } = useVillaAttention();
  // the faults a person closed that the VESTA Agent reads again: LAST in the same list, never counted (owner, 2026-10-23)
  const watched = useWatchedCards();

  return (
    <>
          {/* No headline (owner, 2.496.237): the list below IS the message,
          its count in its title — and when nothing needs attention, the
          Cockpit simply starts with the villa's rooms. */}
      {/* ── Live issues: ONE list (owner, 2026-10-14) ──────────────── */}
      {/* Everything open, one card per device: what Home Assistant reports right now (no buttons — it clears when the
          device does), the faults the VESTA Agent or a person opened, and the tickets in progress. It replaced
          "Needs attention" AND the Faults tab's open list, which showed the same faults twice. Raising a fault is
          here, beside what it is raised about. */}
      {/* The title, and on its right the (i) then "Open a ticket" (owner, 2026-10-14) — a guest's "Report a problem". */}
      {(attentionGroups.length > 0 || watched.length > 0 || canReport) && (
        <div className="cockpit-issues-head">
          <div className="settings-section-title">Open issues{attentionGroups.length > 0 ? ` (${attentionGroups.length})` : ""}</div>
          {canManage && !raising && (
            <div className="cockpit-issues-actions">
              <FaultTiming />
              <button className="btn ghost" onClick={() => setRaising({})}><Plus size={16} /> Open a ticket</button>
            </div>
          )}
          {!canManage && canReport && (
            <div className="cockpit-issues-actions">
              <button className="btn ghost" onClick={onReportProblem}><Plus size={16} /> Report a problem</button>
            </div>
          )}
        </div>
      )}
      {raising && (
        <FaultForm key={raising.entity ?? "new"} presetEntity={raising.entity} deviceOptions={deviceOptions}
          onDone={() => setRaising(null)} />
      )}
      {(attentionGroups.length > 0 || watched.length > 0) && (
        <div className="cockpit-attention-list">
          {attentionGroups.map((group) => (
            <CockpitAttentionRow key={group.key} group={group} onOpenEntity={onOpenEntity}
              canManage={canManage} onEditTicket={onEditTicket} />
          ))}
          {/* after every open issue, and not in its count: closed, the VESTA Agent confirming it (fm/faultConfirm) */}
          {watched.map((card) => <WatchedRow key={card.key} card={card} onOpenEntity={onOpenEntity} />)}
        </div>
      )}

    </>
  );
}

/** ⚠️ A FAULT BEING CONFIRMED IS ONE COMPACT ROW (owner, 2026-10-23, option 4 of five looks: "One compact row"): no
 *  card fill, a check in the status green, its device, its fault and who closed it on one line, and when the VESTA
 *  Agent confirms it in a pill — told apart at a glance from the open issues above it, and the least room when several
 *  are confirming. Its frame keeps the `fault-watched` marker. A tap opens its device, as an open issue's card does. */
export function WatchedRow({ card, onOpenEntity }: { card: CardView; onOpenEntity: (id: string) => void }) {
  const open = card.entityId;
  const fault = card.lines[0]?.text;
  const said = card.watched ?? { did: card.lines[0]?.closing ?? "", when: "", tip: "" };
  const inside = (
    <>
      <CheckCircle2 className="fault-watched-icon" size={18} aria-hidden="true" />
      {/* its device alone on the first line, as an open issue's card is titled; its fault and who closed it under it
          (owner, 2026-10-23: "show only the device name in the first line, to mirror the Open issues cards") */}
      <span className="fault-watched-text">
        {/* its room as the same pill right after its name as an open issue's card (AttentionCard's titlePills) */}
        <span className="fault-watched-head">
          <b className="fault-watched-title">{card.title}</b>
          {card.room && <span className="fm-entity-chip fm-chip-static">{card.room}</span>}
        </span>
        <span className="fault-watched-detail">{[fault, said.did].filter(Boolean).join(" · ")}</span>
      </span>
      {said.when && <CheckPill when={said.when} tip={said.tip} />}
    </>
  );
  return open
    ? <button type="button" className="fault-watched" onClick={() => onOpenEntity(open)}>{inside}</button>
    : <div className="fault-watched">{inside}</div>;
}

/** The faults a person closed that the VESTA Agent reads again (fm/faultConfirm), as THIS profile may see them — the
 *  devices it may open, as useVillaAttention filters the open issues. Read again every minute: a card past its moment
 *  goes even when nothing else changes. */
function useWatchedCards(): CardView[] {
  const { data } = useFmData();
  const { status } = useAgent();
  const { entities } = useHA();
  const { config, resolvedRooms } = useConfig();
  const { devices, visibleTo } = useVillaModel();
  const { role } = useProfile();
  const now = useNow(60_000);
  const cadence = status?.cadence ?? null;
  return useMemo(() => {
    const sees = visibleTo(role);
    return confirmingCards(confirmingFaults(data, cadence, now),
      { devices, entities, entityMap: config.entityMap, resolvedRooms, may: (id) => sees.has(id) });
  }, [data, cadence, now, devices, entities, config.entityMap, resolvedRooms, visibleTo, role]);
}

/** One card of the Live issues, ONE SHAPE whatever it holds (owner, 2026-10-10: "make sure each reported issue
 *  appears in a consistent way"): titled by the device (or by the problem, when no device stands behind it) with its
 *  room, every problem a line INSIDE the card. A card holding a fault carries its actions (owner, 2026-10-14):
 *  "Open Ticket" (was "Mark in progress"; the Tickets tab's wrench and Title Case, owner 2026-10-14) makes the device's faults ONE ticket (each still its own record, so the VESTA Agent can clear
 *  one alone), then "Edit ticket" opens it in the Tickets tab; "Close" closes them all ("no action needed"). A line
 *  that is only what Home Assistant reports has no button: it goes when the device is back. */
function CockpitAttentionRow({ group, onOpenEntity, canManage, onEditTicket }: {
  group: AttentionGroup;
  onOpenEntity: (id: string) => void;
  canManage: boolean;
  onEditTicket: (ticketId: string) => void;
}) {
  const { status } = useAgent();
  const card = cockpitCard(group, status?.cadence ?? null);
  // ONE close-question per card, its own Close and each line's: asking on one puts the others' buttons back
  const closer = useConfirmedClose();
  return <AttentionCard card={card} onOpenEntity={onOpenEntity}
    actions={useCardActions(card, canManage, onEditTicket, closer)}
    lineActions={canManage ? (line) => <LineClose card={card} line={line} closer={closer} /> : undefined} />;
}

/** One problem's own Close, on a card holding several (cockpitCard: the line's `actions`): its question in place of
 *  the button, why it did not land under its line. */
function LineClose({ card, line, closer }: { card: CardView; line: CardLine; closer: ConfirmedClose }) {
  if (line.actions.length === 0) return null;
  const key = `${card.key}|${line.key}`;
  const problem = closer.problemFor(key);
  return (
    <>
      <WorkButtons actions={line.actions} cardKey={key} closer={closer} name={line.text || card.title}
        className="cockpit-line-actions" onAction={() => {}} />
      {problem && <div className="fm-inline-error" role="alert">{problem}</div>}
    </>
  );
}

/** The card itself, drawn — THE Cockpit card (RecordCard), as every list's (architecture review, 2026-10-15): its
 *  source icons before the device's name, the room under it, its problems' lines, its buttons on the right of them.
 *  Tapping it opens the device; its buttons take their own presses. Draws `card` (config/cockpitCard) and nothing
 *  else: what it says is decided there, by value. Pure: a check draws it. */
export function AttentionCard({ card, onOpenEntity, actions, lineActions }: {
  card: CardView;
  onOpenEntity: (id: string) => void;
  actions?: ReactNode;
  /** A line's own buttons (its Close, on a card holding several problems). */
  lineActions?: (line: CardLine) => ReactNode;
}) {
  const open = card.entityId;
  return (
    <RecordCard
      title={card.title}
      // its room as a pill right after its name, on one line (owner, 2026-10-22) — the Spend tab's device pill
      titlePills={card.room ? <span className="fm-entity-chip fm-chip-static">{card.room}</span> : undefined}
      // where its (first) problem comes from, in place of a warning sign (owner, 2026-10-14) — legend: the (i)
      // a fault being confirmed: a check in the status vocabulary's green, in place of its source (owner, 2026-10-23)
      lead={card.lead ? <SourceIcons {...card.lead} /> : undefined}
      // when its problems are read again: a refresh icon and when, a pill at the right of its name (owner, 2026-10-22);
      // hovering it says it in words, with its date and time (owner, 2026-10-19). No chevron: the card is the button.
      check={card.nextCheck ? { when: card.nextCheck.when, tip: card.nextCheck.tip } : undefined}
      onOpen={open ? () => onOpenEntity(open) : undefined}
      body={(
        <ul className="cockpit-attention-subs">
          {card.lines.map((line) => <CockpitAttentionSub key={line.key} line={line} actions={lineActions?.(line)} />)}
        </ul>
      )}
      actions={actions ?? undefined}
    />
  );
}

function CockpitAttentionSub({ line, actions }: { line: CardLine; actions?: ReactNode }) {
  return (
    <li className="cockpit-attention-sub">
      <div className="cockpit-attention-sub-line fm-record-gutter">
        {/* in the card's icon column (RecordCard's gutter), not before the text: every line's text lines up */}
        {line.icons && <span className="fm-record-gutter-icon"><SourceIcons {...line.icons} size={14} /></span>}
        <span className="cockpit-attention-sub-text">
          <Tip text={line.text}><span className="cockpit-attention-sub-title">{line.text}</span></Tip>
          {/* what last happened about it on Telegram — a reminder, an escalation, a button pressed (owner, 2026-10-14) */}
          {line.latest && <span className="cockpit-attention-latest">{line.latest.note} · {localStamp(line.latest.at)}</span>}
          {/* when the VESTA Agent closes it if it stays right (owner, 2026-10-21) */}
          {/* ...or, on a fault being confirmed, who closed it and when the Agent confirms it (owner, 2026-10-23) */}
          {line.closing && <span className="cockpit-attention-latest">{line.closing}</span>}
        </span>
        {/* a press on it is its own: never the card's tap-to-open */}
        {actions && <span className="cockpit-line-act" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>{actions}</span>}
      </div>
    </li>
  );
}

/** A card's buttons, for the profiles that manage Facility work — WHICH buttons, on which records and with which
 *  question is the card's (cockpitCard `actions`: fm/deviceWork, tested by value); WorkButtons draws them. */
function useCardActions(card: CardView, canManage: boolean, onEditTicket: (ticketId: string) => void,
  closer: ConfirmedClose) {
  const { data } = useFmData();
  const [staging, setStaging] = useState<{ tickets: FmTicket[]; to: FmTicketStatus } | null>(null);
  const acts = card.actions;
  if (!canManage || acts.length === 0) return null;
  const records = (ids: readonly string[]) => ids.map((id) => data.tickets.find((t) => t.id === id)).filter((t): t is FmTicket => !!t);
  const problem = closer.problemFor(card.key);
  return (
    <>
      <WorkButtons actions={acts} cardKey={card.key} closer={closer} name={card.title} className="fm-fault-actions"
        onAction={(a) => (a.step.kind === "stage" ? setStaging({ tickets: records(a.ids), to: a.step.to }) : onEditTicket(a.ids[0]))} />
      {problem && <div className="fm-inline-error" role="alert">{problem}</div>}
      {staging && <FaultStageModal tickets={staging.tickets} to={staging.to} onClose={() => setStaging(null)} />}
    </>
  );
}
