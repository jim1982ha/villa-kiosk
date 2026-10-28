// src/components/cockpit/IssueCard.tsx
// An open issue's card, with its buttons: what Messages opens on the right when an issue is chosen (cockpit/
// MessagesTab). It was the Overview tab's list, one card per device; the Overview became Messages › Open issues
// (ticket 17 of "One inbox", owner 2026-10-28): the list is one line per device there, the card unchanged here. The
// villa by room / floor / category and Recent activity were removed before (owner, 2026-10-20).

import { useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import Tip from "@/components/common/Tip";
import { useFmData } from "@/fm/FmDataContext";
import WorkButtons, { useConfirmedClose, type ConfirmedClose } from "@/components/fm/WorkButtons";
import type { CardLine, CardView } from "@/config/cockpitCard";
import { SourceIcons } from "@/components/fm/sourceIcons";
import RecordCard from "@/components/fm/RecordCard";
import FaultStageModal from "@/components/fm/FaultStageModal";
import { localStamp } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";

/** One card of the Live issues, ONE SHAPE whatever it holds (owner, 2026-10-10: "make sure each reported issue
 *  appears in a consistent way"): titled by the device (or by the problem, when no device stands behind it) with its
 *  room, every problem a line INSIDE the card. A card holding a fault carries its actions (owner, 2026-10-14):
 *  "Open Ticket" (was "Mark in progress"; the Tickets tab's wrench and Title Case, owner 2026-10-14) makes the device's faults ONE ticket (each still its own record, so the VESTA Agent can clear
 *  one alone), then "Edit ticket" opens it in the Tickets tab; "Close" closes them all ("no action needed"). A line
 *  that is only what Home Assistant reports has no button: it goes when the device is back. */
export function CockpitAttentionRow({ card, onOpenEntity, canManage, onEditTicket, focused }: {
  card: CardView;
  onOpenEntity: (id: string) => void;
  canManage: boolean;
  onEditTicket: (ticketId: string) => void;
  /** The device a window's warning opened the Cockpit for: its card marked. */
  focused?: boolean;
}) {
  // ONE close-question per card, its own Close and each line's: asking on one puts the others' buttons back
  const closer = useConfirmedClose();
  return <AttentionCard card={card} onOpenEntity={onOpenEntity} focused={focused}
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
export function AttentionCard({ card, onOpenEntity, actions, lineActions, focused }: {
  card: CardView;
  onOpenEntity: (id: string) => void;
  actions?: ReactNode;
  /** Marked, as the card a device window's warning asked for (owner, 2026-10-24). */
  focused?: boolean;
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
      lead={card.look === "watched"
        ? <CheckCircle2 className="fault-watched-icon" size={18} aria-hidden="true" />
        : card.lead ? <SourceIcons {...card.lead} /> : undefined}
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
      // a fault being confirmed: its frame marked, the one place its look differs (owner, 2026-10-23)
      tone={[card.look === "watched" ? "fault-watched" : "", focused ? "cockpit-focus" : ""].filter(Boolean).join(" ") || undefined}
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
          {/* what happened about it on Telegram — the short story its Status tells: the alert sent, a reminder, an
              escalation, a button pressed (owner, 2026-10-14; every line since ticket 19 of "One inbox") */}
          {line.story.length > 0 && (
            <ul className="cockpit-attention-story">
              {line.story.map((s) => <li key={`${s.at} ${s.note}`} className="cockpit-attention-latest">{s.note} · {localStamp(s.at)}</li>)}
            </ul>
          )}
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
