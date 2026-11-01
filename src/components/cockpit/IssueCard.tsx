// src/components/cockpit/IssueCard.tsx
// An issue's card, with its buttons: one card of the Inbox (cockpit/MessagesTab), folded until tapped. It was the
// Overview tab's list, one card per device; the Overview became Messages › Open issues (ticket 17 of "One inbox", owner
// 2026-10-28). The villa by room / floor / category and Recent activity were removed before (owner, 2026-10-20).

import { momentText } from "@/utils/dateText";
import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import WorkButtons, { useCardWork, type RaisedFault } from "@/components/fm/WorkButtons";
import { useRecordPlace } from "@/components/fm/useRecordPlace";
import type { RecordPlace } from "@/fm/recordPlace";
import { cardIcons, rowWhen, type CardLine, type CardView, type LineSources } from "@/config/cockpitCard";
import { SourceIcons } from "@/components/fm/sourceIcons";
import RecordCard, { DeviceChip, Pill } from "@/components/fm/RecordCard";
import { AnnouncementContent } from "@/components/messages/AnnouncementContent";

/** One card of the Live issues, ONE SHAPE whatever it holds (owner, 2026-10-10: "make sure each reported issue
 *  appears in a consistent way"): titled by the device (or by the problem, when no device stands behind it) with its
 *  room, every problem a line INSIDE the card. Every card carries the same buttons (owner, 2026-10-30): Done · Need
 *  help · Open Ticket (fm/deviceWork.overviewActions). Done resolves every record of the card as work done, each read
 *  again by the VESTA Agent; Need help asks the owner to act; "Open Ticket" (the Tickets tab's wrench and Title Case,
 *  owner 2026-10-14) makes the device's faults ONE ticket (each still its own record, so the VESTA Agent can clear one
 *  alone), then "Edit Ticket" opens it in the Tickets tab. A card that is only what the villa's system reports raises
 *  its fault with a Done or a Need help, and Open Ticket opens the ticket form for its device (owner, 2026-10-29). */
export function CockpitAttentionRow({ card, onOpenEntity, canManage, onEditTicket, onRaiseTicket, ...shown }: {
  card: CardView;
  onOpenEntity: (id: string) => void;
  canManage: boolean;
  onEditTicket: (ticketId: string) => void;
  /** Open the ticket form pointed at this device: a card with no record's Open Ticket. */
  onRaiseTicket: (entityId: string) => void;
  /** The device a window's warning opened the Cockpit for: its card marked. */
  focused?: boolean;
  folded?: string;
  onToggle?: () => void;
}) {
  // a profile that does not manage Facility work, or a card with nothing to do (a watched one): no row of buttons
  const actions = canManage && card.actions.length > 0
    ? <CardActionRow card={card} onEditTicket={onEditTicket} onRaiseTicket={onRaiseTicket} /> : undefined;
  return <AttentionCard card={card} onOpenEntity={onOpenEntity} actions={actions} {...shown} />;
}

/** The card itself, drawn — THE Cockpit card (RecordCard), as every list's (architecture review, 2026-10-15): its
 *  source icons before the device's name, its time, the room under it, its problems' lines, its buttons under them.
 *  Tapping it opens or folds it; its device's pill opens the device, its buttons take their own presses. Draws `card`
 *  (config/cockpitCard) and nothing else: what it says is decided there, by value. Pure: a check draws it. */
export function AttentionCard({ card, onOpenEntity, actions, focused, folded, onToggle }: {
  /** The issue as told (messagesModel issueAsTold): a line holding VESTA's message of its alert draws it. */
  card: CardView;
  onOpenEntity: (id: string) => void;
  actions?: ReactNode;
  /** Marked, as the card a device window's warning asked for (owner, 2026-10-24). */
  focused?: boolean;
  /** Folded: its one line (RecordCard `folded`). */
  folded?: string;
  /** A tap on the card opens or folds it. */
  onToggle?: () => void;
}) {
  const icons = cardIcons(card);
  const latest = [...new Set(card.lines.map((l) => l.latest).filter((w): w is string => !!w))];
  return (
    <RecordCard
      title={card.title}
      // the time of its problem, the same as its ticket's (rowWhen)
      when={card.lines.length ? rowWhen(card) : undefined}
      folded={folded}
      // the card's room pill, on the line under its name (CardPillLine)
      room={card.room}
      // its device's own state ("Missing"): the status pill every card has
      status={card.status}
      // where its (first) problem comes from, in place of a warning sign (owner, 2026-10-14) — legend: the (i)
      // a fault being confirmed: a check in the status vocabulary's green, in place of its source (owner, 2026-10-23)
      lead={card.look === "watched"
        ? <CheckCircle2 className="fault-watched-icon" size={18} aria-hidden="true" />
        // folded, its lines not drawn: every icon before its name
        : folded !== undefined && card.lead ? <SourceIcons {...card.lead} />
        : icons.head ? <SourceIcons {...icons.head} />
        // the icon column kept when the lines draw the icons (config/cockpitCard.cardIcons): they stay inside the card
        : icons.column ? <span className="fm-record-lead-empty" aria-hidden="true" /> : undefined}
      // when its problems are read again (a refresh icon) or, on the Watch list, when VESTA closes it (a clock): the
      // card's own pill kind, a pill at the right of its name (owner, 2026-10-22 / 2026-10-31); hovering it says it in
      // words, with its date and time (owner, 2026-10-19). No chevron: the card is the button.
      check={card.nextCheck ? { kind: card.nextCheck.kind, when: card.nextCheck.when, tip: card.nextCheck.tip } : undefined}
      onOpen={onToggle}
      pills={card.entityId || latest.length ? <>
        {card.entityId && <DeviceChip entityId={card.entityId} label={card.title} onOpenEntity={onOpenEntity} />}
        {latest.map((w) => <Pill key={w} text={w} />)}
      </> : undefined}
      body={(
        <ul className="cockpit-attention-subs">
          {card.lines.map((line, i) => <CockpitAttentionSub key={line.key} line={line} icons={icons.lines[i] ?? null} />)}
        </ul>
      )}
      actions={actions ?? undefined}
      // a fault being confirmed: its frame marked, the one place its look differs (owner, 2026-10-23)
      tone={[card.look === "watched" ? "fault-watched" : "", focused ? "cockpit-focus" : ""].filter(Boolean).join(" ") || undefined}
    />
  );
}

function CockpitAttentionSub({ line, icons }: { line: CardLine; icons: LineSources | null }) {
  return (
    <li className="cockpit-attention-sub">
      <div className="cockpit-attention-sub-line fm-record-gutter">
        {/* in the card's icon column (RecordCard's gutter), not before the text: every line's text lines up */}
        {icons && <span className="fm-record-gutter-icon"><SourceIcons {...icons} size={14} /></span>}
        <span className="cockpit-attention-sub-text">
          {/* its words whole, over as many lines as they need: no hover repeats them (owner, 2026-10-31) */}
          <span className="cockpit-attention-sub-title">{line.text}</span>
          {/* what happened about it on Telegram — the short story its Status tells: the alert sent, a reminder, an
              escalation, a button pressed (owner, 2026-10-14; every line since ticket 19 of "One inbox") */}
          {/* ⚠️ AN ALERT'S ISSUE IS ONE CARD (owner, 2026-10-29: "no need to split the card into 2 distinct components"):
              VESTA's message of its alert, joined once (messagesModel issueAsTold), says it all here, as Telegram shows
              it (its "To:", "What to do", its Status: the same story), and the card keeps every card's buttons */}
          {line.told ? <div className="messages-card-body"><AnnouncementContent announcement={line.told} /></div> : (line.story.length > 0 && (
            <ul className="cockpit-attention-story">
              {line.story.map((s) => <li key={`${s.at} ${s.note}`} className="cockpit-attention-latest">{s.note} · {momentText(s.at)}</li>)}
            </ul>
          ))}
          {/* when the VESTA Agent closes it if it stays right (owner, 2026-10-21) */}
          {/* ...or, on a card on the Watch list, how it was cleared, when and by whom (owner, 2026-10-23) */}
          {line.closing && <span className="cockpit-attention-latest">{line.closing}</span>}
        </span>
      </div>
    </li>
  );
}

/** ⚠️ ONE ROW OF BUTTONS ON EVERY ISSUE CARD (owner, 2026-10-30: "I expect to consistently see always Done / Need Help
 *  / Open Ticket"): an alert's card drew VESTA's own buttons, a fault's Open Ticket · Close. WHICH buttons, on which records and with which question is the card's
 *  (cockpitCard `actions`: fm/deviceWork, tested by value); WorkButtons draws them. Done closes the records (VESTA reads
 *  each again), Need help writes a "help" step on them, Open Ticket takes them on; on a card with no record, Done and
 *  Need help raise its device's fault with the press. */
function CardActionRow({ card, onEditTicket, onRaiseTicket }: {
  card: CardView;
  onEditTicket: (ticketId: string) => void;
  onRaiseTicket: (entityId: string) => void;
}) {
  const work = useCardWork();
  const place = useRecordPlace();
  return (
    <WorkButtons actions={card.actions} cardKey={card.key} work={work} name={card.title}
      asked={card.asked} raised={(entityId) => raisedFor(card, place(entityId, card.title))}
      onOpen={(a) => (a.step.kind === "raise" ? onRaiseTicket(a.ids[0]) : onEditTicket(a.ids[0]))} />
  );
}

/** The fault a card with no record raises for its device when Done or Need help is pressed: titled by the device and
 *  what its line says ("LED Strip: Unavailable"), at its `place` (fm/recordPlace: the device's room, from its entity).
 *  ⚠️ NEVER THE CARD'S ROOM LINE (architecture review round 6, 2026-10-30): that is a label — "Other" for a device in
 *  no room (devicePlace.roomLabel) — and the ticket stored "Other" as its room, a pill no other record of it showed. */
export function raisedFor(card: Pick<CardView, "title" | "lines">, place: RecordPlace): RaisedFault {
  const said = card.lines.map((l) => l.text).find((t) => t.trim());
  return { title: said ? `${card.title}: ${said}` : card.title, deviceLabel: card.title,
    ...(place.entityId ? { entityId: place.entityId } : {}), ...(place.room ? { room: place.room } : {}), photoIds: [] };
}
