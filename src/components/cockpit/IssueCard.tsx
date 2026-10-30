// src/components/cockpit/IssueCard.tsx
// An open issue's card, with its buttons: what Messages opens on the right when an issue is chosen (cockpit/
// MessagesTab). It was the Overview tab's list, one card per device; the Overview became Messages › Open issues
// (ticket 17 of "One inbox", owner 2026-10-28): the list is one line per device there, the card unchanged here. The
// villa by room / floor / category and Recent activity were removed before (owner, 2026-10-20).

import { momentText } from "@/utils/dateText";
import { useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import Tip from "@/components/common/Tip";
import { useFmData } from "@/fm/FmDataContext";
import type { FmSaveOutcome } from "@/fm/fmSave";
import WorkButtons, { useConfirmedClose } from "@/components/fm/WorkButtons";
import type { WorkAction } from "@/fm/deviceWork";
import { headIcons, othersFirst, type CardLine, type CardView } from "@/config/cockpitCard";
import { SourceIcons } from "@/components/fm/sourceIcons";
import RecordCard from "@/components/fm/RecordCard";
import FaultStageModal from "@/components/fm/FaultStageModal";

import type { Announcement } from "@/messages/announcements";
import { AnnouncementContent } from "@/components/messages/AnnouncementContent";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";

/** One card of the Live issues, ONE SHAPE whatever it holds (owner, 2026-10-10: "make sure each reported issue
 *  appears in a consistent way"): titled by the device (or by the problem, when no device stands behind it) with its
 *  room, every problem a line INSIDE the card. A card holding a fault carries its actions (owner, 2026-10-14):
 *  "Open Ticket" (was "Mark in progress"; the Tickets tab's wrench and Title Case, owner 2026-10-14) makes the device's faults ONE ticket (each still its own record, so the VESTA Agent can clear
 *  one alone), then "Edit ticket" opens it in the Tickets tab; "Close" closes them all ("no action needed"). A card
 *  that is only what Home Assistant reports has Open Ticket alone, opening the ticket form for its device (owner,
 *  2026-10-29); nothing to close: it goes when the device is back. */
export function CockpitAttentionRow({ card, onOpenEntity, canManage, onEditTicket, onRaiseTicket, focused }: {
  card: CardView;
  onOpenEntity: (id: string) => void;
  canManage: boolean;
  onEditTicket: (ticketId: string) => void;
  /** Open the ticket form pointed at this device: a card with no record's Open Ticket. */
  onRaiseTicket: (entityId: string) => void;
  /** The device a window's warning opened the Cockpit for: its card marked. */
  focused?: boolean;
}) {
  return <AttentionCard card={card} onOpenEntity={onOpenEntity} focused={focused}
    actions={<CardActions card={card} canManage={canManage} onEditTicket={onEditTicket} onRaiseTicket={onRaiseTicket} />} />;
}

/** The card itself, drawn — THE Cockpit card (RecordCard), as every list's (architecture review, 2026-10-15): its
 *  source icons before the device's name, the room under it, its problems' lines, its buttons on the right of them.
 *  Tapping it opens the device; its buttons take their own presses. Draws `card` (config/cockpitCard) and nothing
 *  else: what it says is decided there, by value. Pure: a check draws it. */
export function AttentionCard({ card, onOpenEntity, actions, lineMessage, focused }: {
  card: CardView;
  onOpenEntity: (id: string) => void;
  actions?: ReactNode;
  /** Marked, as the card a device window's warning asked for (owner, 2026-10-24). */
  focused?: boolean;
  /** VESTA's message of a line's alert, drawn in the line in place of its short story (AlertIssueCard). */
  lineMessage?: (line: CardLine) => ReactNode;
}) {
  const open = card.entityId;
  const head = headIcons(card);
  return (
    <RecordCard
      title={card.title}
      // its room as a pill right after its name, on one line (owner, 2026-10-22) — the Spend tab's device pill
      titlePills={card.room ? <span className="fm-entity-chip fm-chip-static">{card.room}</span> : undefined}
      // where its (first) problem comes from, in place of a warning sign (owner, 2026-10-14) — legend: the (i)
      // a fault being confirmed: a check in the status vocabulary's green, in place of its source (owner, 2026-10-23)
      lead={card.look === "watched"
        ? <CheckCircle2 className="fault-watched-icon" size={18} aria-hidden="true" />
        : head ? <SourceIcons {...head} />
        // ⚠️ THE ICON COLUMN STAYS (owner, 2026-10-30: "the icons appear outside the cards"): with every icon said by its
        // line, the name had none, the card dropped its column and the lines' icons hung past its edge
        : card.lead ? <span className="fm-record-lead-empty" aria-hidden="true" /> : undefined}
      // when its problems are read again: a refresh icon and when, a pill at the right of its name (owner, 2026-10-22);
      // hovering it says it in words, with its date and time (owner, 2026-10-19). No chevron: the card is the button.
      check={card.nextCheck ? { when: card.nextCheck.when, tip: card.nextCheck.tip } : undefined}
      onOpen={open ? () => onOpenEntity(open) : undefined}
      body={(
        <ul className="cockpit-attention-subs">
          {card.lines.map((line) => <CockpitAttentionSub key={line.key} line={line}
            message={lineMessage?.(line)} />)}
        </ul>
      )}
      actions={actions ?? undefined}
      // a fault being confirmed: its frame marked, the one place its look differs (owner, 2026-10-23)
      tone={[card.look === "watched" ? "fault-watched" : "", focused ? "cockpit-focus" : ""].filter(Boolean).join(" ") || undefined}
    />
  );
}

function CockpitAttentionSub({ line, message }: { line: CardLine; message?: ReactNode }) {
  return (
    <li className="cockpit-attention-sub">
      <div className="cockpit-attention-sub-line fm-record-gutter">
        {/* in the card's icon column (RecordCard's gutter), not before the text: every line's text lines up */}
        {line.icons && <span className="fm-record-gutter-icon"><SourceIcons {...line.icons} size={14} /></span>}
        <span className="cockpit-attention-sub-text">
          <Tip text={line.text}><span className="cockpit-attention-sub-title">{line.text}</span></Tip>
          {/* what happened about it on Telegram — the short story its Status tells: the alert sent, a reminder, an
              escalation, a button pressed (owner, 2026-10-14; every line since ticket 19 of "One inbox") */}
          {/* VESTA's message of its alert says it all (its "To:", "What to do", its Status: the same story) */}
          {message ?? (line.story.length > 0 && (
            <ul className="cockpit-attention-story">
              {line.story.map((s) => <li key={`${s.at} ${s.note}`} className="cockpit-attention-latest">{s.note} · {momentText(s.at)}</li>)}
            </ul>
          ))}
          {/* when the VESTA Agent closes it if it stays right (owner, 2026-10-21) */}
          {/* ...or, on a fault being confirmed, who closed it and when the Agent confirms it (owner, 2026-10-23) */}
          {line.closing && <span className="cockpit-attention-latest">{line.closing}</span>}
        </span>
      </div>
    </li>
  );
}

/** ⚠️ ONE ROW OF BUTTONS ON EVERY ISSUE CARD (owner, 2026-10-30: "I expect to consistently see always Done / Need Help
 *  / Open Ticket"): an alert's card drew VESTA's own buttons, a fault's Open Ticket · Close. The card's buttons, for the
 *  profiles that manage Facility work — WHICH buttons, on which records and with which question is the card's
 *  (cockpitCard `actions`: fm/deviceWork, tested by value); WorkButtons draws them. Done closes the records (VESTA reads
 *  each again), Need help writes a "help" step on them, Open Ticket takes them on; on a card with no record, Done and
 *  Need help raise its device's fault with the press. */
function CardActions({ card, canManage, onEditTicket, onRaiseTicket }: {
  card: CardView;
  canManage: boolean;
  onEditTicket: (ticketId: string) => void;
  onRaiseTicket: (entityId: string) => void;
}) {
  // a profile that does not manage Facility work, or a card with nothing to do: no row, and no read of the records
  return canManage && card.actions.length > 0
    ? <CardActionRow card={card} onEditTicket={onEditTicket} onRaiseTicket={onRaiseTicket} /> : null;
}

function CardActionRow({ card, onEditTicket, onRaiseTicket }: {
  card: CardView;
  onEditTicket: (ticketId: string) => void;
  onRaiseTicket: (entityId: string) => void;
}) {
  const { data, helpTickets, addTicket } = useFmData();
  const closer = useConfirmedClose();
  const [staging, setStaging] = useState<{ tickets: FmTicket[]; to: FmTicketStatus } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const acts = card.actions;
  const records = (ids: readonly string[]) => ids.map((id) => data.tickets.find((t) => t.id === id)).filter((t): t is FmTicket => !!t);
  const said = async (write: Promise<FmSaveOutcome>) => {
    setFailed(null);
    const { done, note } = await write;
    if (!done && note) setFailed(note);
  };
  const act = (a: WorkAction) => {
    const step = a.step;
    if (step.kind === "stage") setStaging({ tickets: records(a.ids), to: step.to });
    else if (step.kind === "help") void said(helpTickets(a.ids));
    else if (step.kind === "raiseThen") void said(addTicket(raisedFor(card, a.ids[0]), { then: step.then }));
    else if (step.kind === "raise") onRaiseTicket(a.ids[0]);
    else onEditTicket(a.ids[0]);
  };
  const problem = closer.problemFor(card.key) ?? failed;
  return (
    <>
      <WorkButtons actions={acts} cardKey={card.key} closer={closer} name={card.title} className="fm-fault-actions"
        onAction={act} />
      {problem && <div className="fm-inline-error" role="alert">{problem}</div>}
      {staging && <FaultStageModal tickets={staging.tickets} to={staging.to} onClose={() => setStaging(null)} />}
    </>
  );
}

/** The fault a card with no record raises for its device when Done or Need help is pressed: titled by the device and
 *  what its line says ("LED Strip: Unavailable"), in its room. */
export function raisedFor(card: Pick<CardView, "title" | "room" | "lines">, entityId: string): Omit<FmTicket, "id" | "openedAt" | "status"> {
  const said = card.lines.map((l) => l.text).find((t) => t.trim());
  return { title: said ? `${card.title}: ${said}` : card.title, entityId, deviceLabel: card.title,
    ...(card.room ? { room: card.room } : {}), photoIds: [] };
}

/** ⚠️ AN ALERT'S ISSUE IS ONE CARD (owner, 2026-10-29: "no need to split the card into 2 distinct components, since the
 *  same button shall consistently appear for any type"): the issue's own card — its device, room and next check — with
 *  VESTA's message of the alert inside its line (as Telegram shows it: "To:", what happened, "What to do", its Status),
 *  and VESTA's buttons (Done · Need help: RecordButtons, the same row as its notice and its Notifications card). Its
 *  ticket is opened and closed in the Tickets tab. Before, VESTA's card stood above the issue's, each with its buttons.
 *  `messages`: VESTA's card of each line's alert (messagesModel.messageOfLine). */
export function AlertIssueCard({ card, messages, onOpenEntity, focused, canManage, onEditTicket, onRaiseTicket }: {
  card: CardView;
  messages: (line: CardLine) => Announcement | null;
  onOpenEntity: (id: string) => void;
  focused?: boolean;
  canManage: boolean;
  onEditTicket: (ticketId: string) => void;
  onRaiseTicket: (entityId: string) => void;
}) {
  // said once (owner, 2026-10-29 screenshot: the problem and "Cleared on …" twice): a line VESTA holds a message for is
  // named by its title ("#92-P2 (cleared)"), its words in the message; on a watched card its Status says how it closed
  const said: CardView = othersFirst({ ...card, lines: card.lines.map((l) => {
    const a = messages(l);
    return a ? { ...l, text: a.title, closing: card.look === "watched" ? null : l.closing } : l;
  }) }, (l) => messages(l) !== null);
  return (
    <AttentionCard card={said} onOpenEntity={onOpenEntity} focused={focused}
      lineMessage={(line) => {
        const a = messages(line);
        return a ? <div className="messages-card-body"><AnnouncementContent announcement={a} /></div> : undefined;
      }}
      // the same row as every issue card's (CardActions): its Done and Need help reach the alert desk through the
      // alert's fault, as the Telegram buttons do (the VESTA Agent's closed_in_kiosk, its "help" step)
      actions={<CardActions card={card} canManage={canManage} onEditTicket={onEditTicket} onRaiseTicket={onRaiseTicket} />} />
  );
}
