// src/components/fm/RecordCard.tsx
// THE card of every Cockpit list — an open issue in Messages, a ticket, a closed ticket, a scheduled task, a spend
// line, a piece of work done (owner, 2026-10-14/15: "the same style as any other card, fully re-using the same code").
// Its title with a status pill (and a line under it: the room), the line of pills and when, its notes, photos and
// reports — or its own lines (`body`: an open issue's problems) — a cost on the right, and its buttons in a row under
// its text, on the right, inside the card (owner, 2026-10-29). Tapping it opens it (`onOpen`); holding it erases it when it can be erased (`erase`:
// ErasableRow, superadmin) — a scheduled task is removed with its own bin instead.
//
// ⚠️ ONE CARD, NOT FOUR (architecture review, 2026-10-15): the Overview, Schedule and Spend each drew their own, so a
// layout request ("buttons inside, on the right", "a note never runs out of the card") was made up to four times.
//
// `framed`: a card of its own (the default) — or a record inside a card holding several (a ticket taken on for several
// faults of one device: TicketsTab draws the frame). `lead`: what stands before the title (an open issue's source
// icons); `titlePills`: pills right after the title, on its line (a spend's device); `room` and `status`: the line under
// the title (CardPillLine); `check`: its next check, a refresh icon and when, right after the room; `tone`: the card's own
// tint.
//
// ⚠️ ONE FOLD (owner, 2026-11-01): `folded`, a notification's or a report's until tapped: its caller hands its card whole
// and this one place swaps its text for that cut line, so no card can fold its own way.
//
// ⚠️ THE NAME AND ITS TIME, THEN ITS PILLS (owner, 2026-11-01: the next check "right after the room area pill"): folded or
// opened, a card's second line is the same CardPillLine: the room and its next check on the left, its state on the right.

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import Tip from "@/components/common/Tip";
import ErasableRow from "./ErasableRow";
import EvidenceRow from "./EvidenceRow";
import RecordMeta, { RecordNotes } from "./RecordMeta";
import { PageLink } from "@/components/messages/AnnouncementContent";

/** A card's status pill: `tone` is the badge's colour class (fm/tone pillClass). */
export interface RecordStatus { text: string; tone: string }

export interface RecordCardProps {
  title: ReactNode;
  /** Its status pill, or several (StatusPill). */
  status?: RecordStatus | RecordStatus[];
  lead?: ReactNode;
  /** Pills right after the title, on its line (a spend's device). */
  titlePills?: ReactNode;
  /** Its room, as THE room pill (Pill), on the title's line after its pills: every card that shows a room. */
  room?: string;
  /** Its next check, right after the room: `when` beside the refresh icon, `tip` on hover (CheckPill). */
  check?: { when: string; tip: string };
  /** The line of tags above its text (the device, who last moved it, "by VESTA Agent" on a task or a spend line…). */
  pills?: ReactNode;
  /** When, as a pill at the right of the title's line, on every card (owner, 2026-11-01). */
  when?: string;
  notes?: (string | undefined | null)[];
  /** Lines of its own, in place of the notes (an open issue's problems). */
  body?: ReactNode;
  /** Folded: this line, cut with "…", stands for its text; undefined: the card whole. */
  folded?: string;
  photoIds?: string[];
  /** VESTA's pages kept with it (a report's, a ticket's investigation), opened on the iPad, offline: first in its
   *  button row, folded or whole (architecture review 19 #3: a ticket's were drawn under its notes, only when whole,
   *  while a report's sat in the button row). */
  pages?: { id: string; label: string }[];
  /** A cost, formatted, at the right of the text. */
  amount?: string;
  actions?: ReactNode;
  erase?: { title: string; detail: string; run: (token: string) => Promise<unknown> };
  onOpen?: () => void;
  framed?: boolean;
  /** The frame's tint: fm/tone's toneClass ("tone-warn", "tone-danger"), none when all is well. */
  tone?: string;
  /** Its state said among its tags (a ticket's pill of who last moved it): drawn there, after `pills`, and on its
   *  buttons' row on a wide card (ActionsRow), by this card alone. */
  tagState?: RecordStatus | null;
  /** Its status is shown in a buttons' row of its `body` (an open issue's first problem) on a wide card. */
  statusInBody?: boolean;
}

/** The class of a pill that its card's buttons' row shows on a wide card (ActionsRow): there, it is not drawn here.
 *  ⚠️ PLACED HERE ONLY (architecture review 23): each kind of card marked its own pills with it and passed its own hints
 *  (rowState, statusInBody), three things kept in step by hand; a card's state now goes in once (`status`, `tagState`)
 *  and an Inbox problem's pill through StateWhereItStands. */
const STATE_INLINE = "fm-state-inline";

/** A state pill where it stands in a card's text, hidden there on a wide card when its buttons' row says it
 *  (`atButtons`): an Inbox problem's pill of who last moved it (IssueCard). */
export function StateWhereItStands({ atButtons, className, children }: { atButtons: boolean; className?: string; children: ReactNode }) {
  const cls = [className, atButtons ? STATE_INLINE : ""].filter(Boolean).join(" ");
  return <span className={cls || undefined}>{children}</span>;
}

/** ⚠️ A CARD'S STATE ON ITS BUTTONS' LINE (owner, 2026-11-05: "the coloured pill … on the same line as the buttons on
 *  desktop, vertically centered", the "Unavailable" pill too, on every card of every tab): a card's buttons' row, its
 *  state pills at its left on a wide card; on a narrow one (a phone) they stay where they stand (STATE_INLINE), the
 *  row is the buttons alone (07-facility.css, the card's width). Every card's buttons' row is this one. */
export function ActionsRow({ state, children }: { state?: ReactNode; children: ReactNode }) {
  return (
    // a press on a button is the button's: never the card's hold-to-erase, never its tap-to-open
    <div className="fm-record-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {state && <span className="fm-work-state">{state}</span>}
      {children}
    </div>
  );
}

/** ⚠️ ONE PILL for when VESTA looks again (owner, 2026-10-23: an open issue's and a cleared fault's alike; 2026-11-01:
 *  the refresh icon on both, so a time on a card is plainly its next check): the icon and when, its words on hover. */
export function CheckPill({ when, tip }: { when: string; tip: string }) {
  return (
    <Tip text={tip}>
      <span className="fm-entity-chip fm-chip-static fm-record-check" aria-label={tip}>
        <RefreshCw size={12} aria-hidden="true" />{when}
      </span>
    </Tip>
  );
}

/** ⚠️ ONE PILL FOR WHAT A CARD SAYS OF ITSELF (architecture review round 13, 2026-11-01: the Inbox drew the room as a
 *  framed pill, Tickets, Schedule and Today as plain grey text among the other tags; owner, 2026-11-01: the time and who
 *  last moved it too): the Spend tab's device pill's look (owner, 2026-11-01: "the area pill … reusing existing code"). */
export function Pill({ text, className = "" }: { text: string; className?: string }) {
  return <span className={`fm-entity-chip fm-chip-static${className ? ` ${className}` : ""}`}>{text}</span>;
}

/** The device's pill on a ticket opens its window; a device no longer known, its name alone. */
export function DeviceChip({ entityId, label, onOpenEntity }: {
  entityId?: string; label?: string; onOpenEntity: (id: string) => void;
}) {
  if (!entityId) return label ? <Pill text={label} /> : null;
  return (
    <Tip text={entityId}>
      <button className="fm-entity-chip" onClick={(e) => { e.stopPropagation(); onOpenEntity(entityId); }}>{label}</button>
    </Tip>
  );
}

/** ⚠️ A STATE IS ONE PILL ON EVERY COCKPIT CARD (owner, 2026-11-01): a ticket's stage, a task's due state, an issue's
 *  device state ("Missing"): its card's `status`. */
export function StatusPill({ text, tone }: RecordStatus) {
  return <span className={`fm-badge ${tone}`}>{text}</span>;
}

/** A card's line of pills, folded or whole: its room and next check on the left, its state on the right (owner,
 *  2026-11-01); nothing with none. */
function CardPillLine({ room, check, status, atButtons }: {
  room?: string; check?: RecordCardProps["check"]; status: readonly RecordStatus[];
  /** Its status is in a buttons' row too (ActionsRow): drawn here on a narrow card only. */
  atButtons?: boolean;
}) {
  if (!room && !check && status.length === 0) return null;
  return (
    <span className="card-pill-line">
      {room && <Pill text={room} />}
      {check && <CheckPill {...check} />}
      {status.length > 0 && (
        <span className={`card-pill-status${atButtons ? ` ${STATE_INLINE}` : ""}`}>{status.map((s) => <StatusPill key={s.text} {...s} />)}</span>
      )}
    </span>
  );
}

export default function RecordCard({ title, status, lead, titlePills, room, when, check, pills, notes, body, folded, photoIds,
  pages, amount, actions, erase, onOpen, framed = true, tone, tagState, statusInBody }: RecordCardProps) {
  const whole = folded === undefined;
  const statuses = [status ?? []].flat();
  const row = !!actions || (pages?.length ?? 0) > 0;
  const rowPills = row && (statuses.length > 0 || tagState)
    ? <>{statuses.map((s) => <StatusPill key={s.text} {...s} />)}{tagState && <StatusPill {...tagState} />}</> : undefined;
  const tags = (pills || tagState) && <>{pills}{tagState && <StateWhereItStands atButtons={row}><StatusPill {...tagState} /></StateWhereItStands>}</>;
  const inside = (
    <>
      <div className="fm-record-head">
        {lead && <span className="fm-record-lead">{lead}</span>}
        <div className="fm-row-title">
          <strong>{title}</strong>
          {titlePills}
        </div>
        {when && <Pill text={when} className="fm-record-check" />}
      </div>
      <CardPillLine room={room} check={check} status={statuses} atButtons={(row && statuses.length > 0) || statusInBody} />
      {/* its text the card's width (its cost beside it), its buttons under it on the right (owner, 2026-10-29) */}
      <div className="fm-record-body">
        <div className="fm-row-main">
          {!whole && <span className="fm-card-folded">{folded}</span>}
          {whole && tags && <RecordMeta>{tags}</RecordMeta>}
          {whole && (body ?? <RecordNotes notes={notes ?? []} />)}
          {whole && (photoIds?.length ?? 0) > 0 && <EvidenceRow photoIds={photoIds!} disabled />}
        </div>
        {amount && <span className="fm-amount">{amount}</span>}
        {row && (
          <ActionsRow state={rowPills}>
            {pages?.map((p) => <PageLink key={p.id} page={p.id} label={p.label} />)}
            {actions}
          </ActionsRow>
        )}
      </div>
    </>
  );
  const record = erase ? (
    <ErasableRow className="fm-record" intent={{ title: erase.title, detail: erase.detail }}
      erase={(token) => erase.run(token)} onOpen={onOpen}>
      {inside}
    </ErasableRow>
  ) : (
    // nothing to erase by holding it: the same card, tapped to open (a button for the keyboard and screen readers)
    <div className={`fm-row fm-record${onOpen ? " fm-openable" : ""}`} tabIndex={onOpen ? 0 : undefined}
      role={onOpen ? "button" : undefined}
      onClick={onOpen ? (e) => { if (!(e.target as HTMLElement).closest("button,a,input,select,textarea")) onOpen(); } : undefined}
      onKeyDown={onOpen ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } } : undefined}>
      {inside}
    </div>
  );
  return framed ? <div className={`fm-record-card${tone ? ` ${tone}` : ""}`}>{record}</div> : record;
}
