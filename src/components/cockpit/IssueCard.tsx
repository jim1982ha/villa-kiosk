// src/components/cockpit/IssueCard.tsx
// An issue's card, with its buttons: one card of the Inbox (cockpit/MessagesTab). It was the
// Overview tab's list, one card per device; the Overview became Messages › Open issues (ticket 17 of "One inbox", owner
// 2026-10-28). The villa by room / floor / category and Recent activity were removed before (owner, 2026-10-20).

import { momentText } from "@/utils/dateText";
import type { ReactNode } from "react";
import WorkButtons, { useCardWork, type RaisedFault } from "@/components/fm/WorkButtons";
import { useRecordPlace } from "@/components/fm/useRecordPlace";
import type { RecordPlace } from "@/fm/recordPlace";
import { cardIcons, cardStrip, lineStrip, rowWhen, toldShown, type CardLine, type CardView } from "@/config/cockpitCard";
import { IconTip, SourceIcons, WatchedIcon } from "@/components/fm/sourceIcons";
import RecordCard, { type CardPart } from "@/components/fm/RecordCard";
import { moveWho } from "@/fm/faultNotes";
import { ACCENT_PILL } from "@/fm/tone";
import { AnnouncementContent } from "@/components/messages/AnnouncementContent";

/** One card of the Live issues, ONE SHAPE whatever it holds (owner, 2026-10-10: "make sure each reported issue
 *  appears in a consistent way"): titled by the device (or by the problem, when no device stands behind it) with its
 *  room, every problem a section INSIDE the card, always whole (owner, 2026-11-01: never folded, the card itself not
 *  pressed), each with its own buttons beside it where the width allows: Done · Not a problem · Open Ticket · Need help
 *  (fm/deviceWork.overviewActions). Done resolves that problem's records as work done, each read again by the VESTA
 *  Agent; Need help asks the owner to act; "Open Ticket" makes them a ticket, then "Edit Ticket" opens it in the Tickets
 *  tab. A problem that is only what the villa's system reports raises its fault with a Done or a Need help, and Open
 *  Ticket opens the ticket form for its device (owner, 2026-10-29). */
export function CockpitAttentionRow({ card, onOpenEntity, canManage, onEditTicket, onRaiseTicket, focused }: {
  card: CardView;
  onOpenEntity: (id: string) => void;
  canManage: boolean;
  onEditTicket: (ticketId: string) => void;
  /** Open the ticket form pointed at this device: a problem with no record's Open Ticket. */
  onRaiseTicket: (entityId: string) => void;
  /** The device a window's warning opened the Cockpit for: its card marked. */
  focused?: boolean;
}) {
  // a profile that does not manage Facility work, or a problem with nothing to do (a watched one): no buttons
  const buttons = (line: CardLine) => (canManage && line.actions.length > 0
    ? <LineActions card={card} line={line} onEditTicket={onEditTicket} onRaiseTicket={onRaiseTicket} /> : null);
  return <AttentionCard card={card} onOpenEntity={onOpenEntity} buttons={buttons} focused={focused} />;
}

/** The card itself, drawn — THE Cockpit card (RecordCard), as every list's (architecture review, 2026-10-15): its
 *  strip (its source icons, its alert's name, its name, its time), where it stands, its room and next check, its
 *  problems. Its name opens the device. Draws `card` (config/cockpitCard) and nothing else: what it says is decided
 *  there, by value (cardStrip, lineStrip, faultNotes.moveWho). Pure: a check draws it. */
export function AttentionCard({ card, onOpenEntity, buttons, focused }: {
  /** The issue as told (messagesModel issueAsTold): a line holding VESTA's message of its alert draws it. */
  card: CardView;
  onOpenEntity: (id: string) => void;
  /** A problem's buttons: its own bar. */
  buttons?: (line: CardLine) => ReactNode;
  /** Marked, as the card a device window's warning asked for (owner, 2026-10-24). */
  focused?: boolean;
}) {
  const icons = cardIcons(card);
  const strip = cardStrip(card);
  // ⚠️ A WATCH CARD'S FIRST LINE SAYS WHEN IT CLOSES (owner, 2026-11-05: "Closes 15:06" with its (i)); how it was cleared,
  // when and by whom, is its who line
  const watch = card.look === "watched" && card.nextCheck ? card.nextCheck : null;
  const status = watch ? [{ text: watch.when, tone: ACCENT_PILL }] : strip.status;
  const when = card.lines.length ? rowWhen(card) : undefined;
  const parts: CardPart[] = card.lines.map((line, i) => {
    const own = lineStrip(line);
    const alone = card.lines.length === 1;
    // its time and its state as the card says them: the card's for one problem, its header's for one of several
    const said = alone ? status : own.status, at = alone ? when : rowWhen({ lines: [line] });
    return {
      key: line.key, status: own.status, number: own.number, when: at, tone: own.tone,
      lead: icons.lines[i] ? <SourceIcons {...icons.lines[i]!} size={14} /> : undefined,
      text: <LineWords line={line} look={card.look} />,
      who: card.look === "watched" ? line.closing : moveWho(line.move, said.map((s) => s.text), at, momentText),
      actions: buttons?.(line) ?? undefined,
    };
  });
  return (
    <RecordCard
      // ⚠️ ITS NAME OPENS THE DEVICE (owner, 2026-11-01, the audit: a device pill said the name again under it)
      title={card.entityId
        ? <button type="button" className="fm-title-link" onClick={() => onOpenEntity(card.entityId!)}>{card.title}</button> : card.title}
      // the time of its problem, the same as its ticket's (rowWhen)
      when={when}
      room={card.room}
      status={status}
      statusTip={watch?.tip}
      number={strip.number}
      // where its problems come from, in place of a warning sign (owner, 2026-10-14) — legend: the (i)
      // a fault being confirmed: a check in the status vocabulary's green, in place of its source (owner, 2026-10-23)
      lead={card.look
        ? <IconTip k="watch" icon={<WatchedIcon size={18} />} />
        : icons.head ? <SourceIcons {...icons.head} /> : undefined}
      // when its problems are read again: quiet text after its room; hovering it says it in words, with its date and
      // time (owner, 2026-10-19). On the Watch list it is the strip's.
      check={card.nextCheck && !watch ? { when: card.nextCheck.when, tip: card.nextCheck.tip } : undefined}
      parts={parts}
      // its strip's colour when nothing is said (cardStrip); a fault being confirmed: its frame marked (owner, 2026-10-23)
      tone={[strip.tone, card.look === "watched" ? "fault-watched" : "", focused ? "cockpit-focus" : ""].filter(Boolean).join(" ")}
    />
  );
}

/** A problem's words: what is wrong, VESTA's message of its alert or its short story on Telegram, when it closes. */
function LineWords({ line, look }: { line: CardLine; look: CardView["look"] }) {
  const watched = look === "watched", told = toldShown(line, look);
  return (
    <div className="cockpit-attention-sub-text">
      {/* its words whole, over as many lines as they need: no hover repeats them (owner, 2026-10-31) */}
      {line.text && <span className="cockpit-attention-sub-title">{line.text}</span>}
      {/* ⚠️ AN ALERT'S ISSUE IS ONE CARD (owner, 2026-10-29: "no need to split the card into 2 distinct components"):
          VESTA's message of its alert, joined once (messagesModel issueAsTold), says it all here, as Telegram shows
          it (its "To:", "What to do", its Status: the same story); else what happened about it on Telegram — the
          alert sent, a reminder, an escalation, a button pressed (owner, 2026-10-14; ticket 19 of "One inbox") */}
      {/* its Status once: the state line says where it stands (cockpitCard.toldShown) */}
      {told ? <div className="messages-card-body"><AnnouncementContent announcement={told} /></div> : (line.story.length > 0 && (
        <ul className="cockpit-attention-story">
          {line.story.map((s) => <li key={`${s.at} ${s.note}`} className="cockpit-attention-latest">{s.note} · {momentText(s.at)}</li>)}
        </ul>
      ))}
      {/* when the VESTA Agent closes it if it stays right (owner, 2026-10-21); on the Watch list, how it was cleared is
          its who line */}
      {line.closing && !watched && <span className="cockpit-attention-latest">{line.closing}</span>}
    </div>
  );
}

/** ⚠️ THE SAME BUTTONS ON EVERY PROBLEM (owner, 2026-10-30: "I expect to consistently see always Done / Need Help /
 *  Open Ticket"): an alert's card drew VESTA's own buttons, a fault's Open Ticket · Close. WHICH buttons, on which records and with which question is the card's
 *  (its line's `actions`: fm/deviceWork, tested by value); WorkButtons draws them. Done closes the records (VESTA reads
 *  each again), Need help writes a "help" step on them, Open Ticket takes them on; on a line with no record, Done and
 *  Need help raise its device's fault with the press. */
function LineActions({ card, line, onEditTicket, onRaiseTicket }: {
  card: CardView;
  line: CardLine;
  onEditTicket: (ticketId: string) => void;
  onRaiseTicket: (entityId: string) => void;
}) {
  const work = useCardWork();
  const place = useRecordPlace();
  return (
    <WorkButtons actions={line.actions} cardKey={`${card.key}|${line.key}`} work={work} name={card.title}
      asked={line.asked} raised={(entityId) => raisedFor({ title: card.title, lines: [line] }, place(entityId, card.title))}
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
