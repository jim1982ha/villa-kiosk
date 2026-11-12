// src/components/cockpit/IssueCard.tsx
// An issue's card, with its buttons: one card of the Inbox (cockpit/MessagesTab). It was the
// Overview tab's list, one card per device; the Overview became Messages › Open issues (ticket 17 of "One inbox", owner
// 2026-10-28). The villa by room / floor / category and Recent activity were removed before (owner, 2026-10-20).

import { statusMoment } from "@/utils/dateText";
import type { ReactNode } from "react";
import WorkButtons, { useCardWork } from "@/components/fm/WorkButtons";
import type { RaisedFault } from "@/fm/workPress";
import { useRecordPlace } from "@/components/fm/useRecordPlace";
import type { RecordPlace } from "@/fm/recordPlace";
import { cardFace, toldShown, type CardLine, type CardView } from "@/config/cockpitCard";
import { cardLead, SourceIcons } from "@/components/fm/sourceIcons";
import RecordCard, { type CardPart, type RecordCardProps } from "@/components/fm/RecordCard";
import { useFmDataOrNull } from "@/fm/FmDataContext";
import { backendFetch } from "@/auth/sessionLost";
import { eraseMessage, type Announcement } from "@/messages/announcements";
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
  const fm = useFmDataOrNull();
  return <AttentionCard card={card} onOpenEntity={onOpenEntity} buttons={buttons} focused={focused}
    erase={fm ? cardErase(card, fm.removeTicket, (a, token) => eraseMessage(a, token, backendFetch)) : undefined} />;
}

/** ⚠️ EVERY CLOSED RECORD IS ERASED THE SAME WAY (owner, 2026-11-07: a hold on #134-P1's card under Closed did nothing,
 *  while the villa's message beside it asked for the superadmin code): held, the card's records (`erases`) and the
 *  messages it tells (VESTA's, or the villa's own visit's: messagesModel.villaAlertCards, owner 2026-11-07: its closed
 *  card did nothing on a hold) are erased, behind the superadmin code (RecordCard `erase`: ErasableRow), as a message's
 *  card and a ticket are. Only a closed card; none on a card nothing erases (an open issue, Watch). Pure: a check runs it. */
export function cardErase(card: CardView, removeTicket: (id: string, token: string) => Promise<unknown>,
  removeMessage: (a: Announcement, token: string) => Promise<unknown>): RecordCardProps["erase"] {
  if (card.look !== "closed") return undefined;
  const ids = card.erases ?? [];
  const told = card.lines.flatMap((l) => (l.told ? [l.told] : []));
  if (ids.length === 0 && told.length === 0) return undefined;
  return {
    title: "Erase this record", detail: [card.lines[0]?.alertLabel, card.title].filter(Boolean).join(" "),
    // a message's erase that did not happen is its line (announcements eraseMessage), handed on to be said
    run: async (token) => {
      for (const id of ids) await removeTicket(id, token);
      let said: unknown = null;
      for (const a of told) said = (await removeMessage(a, token)) ?? said;
      return said;
    },
  };
}

/** The card itself, drawn — THE Cockpit card (RecordCard), as every list's (architecture review, 2026-10-15): its
 *  strip (its source icons, its alert's name, its name, its time), where it stands, its room and next check, its
 *  problems. Its name opens the device. Draws `card` (config/cockpitCard) and nothing else: what it says is decided
 *  there, by value (cockpitCard.cardFace). Pure: a check draws it. */
export function AttentionCard({ card, onOpenEntity, buttons, focused, erase }: {
  /** The issue as told (messagesModel issueAsTold): a line holding VESTA's message of its alert draws it. */
  card: CardView;
  onOpenEntity: (id: string) => void;
  /** A problem's buttons: its own bar. */
  buttons?: (line: CardLine) => ReactNode;
  /** Marked, as the card a device window's warning asked for (owner, 2026-10-24). */
  focused?: boolean;
  /** What a hold on it erases (cardErase): a closed card's records. */
  erase?: RecordCardProps["erase"];
}) {
  // its whole head, as the alert's notice over the villa and the Tickets tab say it too (cockpitCard.cardFace)
  const face = cardFace(card);
  const parts: CardPart[] = card.lines.map((line, i) => {
    const { icons, ...head } = face.parts[i];
    return {
      ...head,
      lead: icons ? <SourceIcons {...icons} size={14} /> : undefined,
      text: <LineWords line={line} look={card.look} />,
      actions: buttons?.(line) ?? undefined,
    };
  });
  return (
    <RecordCard
      // ⚠️ ITS NAME OPENS THE DEVICE (owner, 2026-11-01, the audit: a device pill said the name again under it)
      title={card.entityId
        ? <button type="button" className="fm-title-link" onClick={() => onOpenEntity(card.entityId!)}>{card.title}</button> : card.title}
      // the time of its problem, the same as its ticket's (rowWhen)
      when={face.when}
      room={card.room}
      status={face.status}
      statusTip={face.statusTip}
      number={face.number}
      // where its problems come from, or the Watch list's check (sourceIcons.cardLead) — legend: the (i)
      lead={cardLead(card)}
      // when its problems are read again: a pill at the right of its first line (owner, 2026-11-06); hovering it says it
      // in words, with its date and time (owner, 2026-10-19). On the Watch list the first line says when it closes.
      check={face.check}
      parts={parts}
      erase={erase}
      // its strip's colour when nothing is said (cardStrip); a fault being confirmed: its frame marked (owner, 2026-10-23)
      tone={[face.tone, card.look === "watched" ? "fault-watched" : "", focused ? "cockpit-focus" : ""].filter(Boolean).join(" ")}
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
          {line.story.map((s) => <li key={`${s.at} ${s.note}`} className="cockpit-attention-latest">{s.note} · {statusMoment(s.at, line.openedAt)}</li>)}
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
      onOpen={(go) => (go.to === "raiseTicket" ? onRaiseTicket(go.id) : onEditTicket(go.id))} />
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
