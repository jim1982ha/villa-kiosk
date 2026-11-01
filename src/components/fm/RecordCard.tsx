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
// the title (CardPillLine); `check`: a pill at the right of that line, its kind's icon and when (an open issue's next check: a refresh icon; a card on the
// Watch list, when VESTA closes it: a clock); `tone`: the card's own tint.
//
// ⚠️ ONE FOLD (owner, 2026-11-01: the Inbox's list of rows and its pane on the right replaced by its cards, tapped open):
// `folded` is the whole of a folded card: every caller hands its card whole and this one place swaps its text for those
// cut lines, its buttons staying as on a Tickets card, so no kind of card can fold its own way.
//
// ⚠️ THE NAME AND ITS NEXT CHECK, THEN ITS PILLS (owner, 2026-11-01: "only keep the refresh interval on the first line"):
// opened or as a line in the Inbox, a card's second line is the same CardPillLine, the room left, the pills right.

import type { ReactNode } from "react";
import { Clock, FileText, RefreshCw, type LucideIcon } from "lucide-react";
import Tip from "@/components/common/Tip";
import ErasableRow from "./ErasableRow";
import EvidenceRow from "./EvidenceRow";
import RecordMeta, { RecordNotes } from "./RecordMeta";
import { documentUrl } from "@/fm/fmApi";
import type { CheckPillKind } from "@/fm/faultTiming";

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
  /** The pill at the right of the title's line: its kind's icon, `when` beside it, `tip` on hover (CheckPill). */
  check?: { kind: CheckPillKind; when: string; tip: string };
  /** The line of tags above its text (the device, who last moved it, "by VESTA Agent" on a task or a spend line…). */
  pills?: ReactNode;
  /** When, as a pill at the right of the title's line, on every card (owner, 2026-11-01). */
  when?: string;
  notes?: (string | undefined | null)[];
  /** Lines of its own, in place of the notes (an open issue's problems). */
  body?: ReactNode;
  /** Folded: these lines, one per problem, each cut with "…", stand for its text; undefined: the card whole. */
  folded?: string[];
  photoIds?: string[];
  documentIds?: string[];
  /** A cost, formatted, at the right of the text. */
  amount?: string;
  actions?: ReactNode;
  erase?: { title: string; detail: string; run: (token: string) => Promise<unknown> };
  onOpen?: () => void;
  framed?: boolean;
  /** The frame's tint: fm/tone's toneClass ("tone-warn", "tone-danger"), none when all is well. */
  tone?: string;
}

/** Each kind's icon (faultTiming CheckPillKind): a next look, the refresh icon; a close, a clock — never the refresh
 *  icon, read as "next check" on a card about to close (owner, 2026-10-31), nor the check its card leads with. */
const CHECK_ICON: Record<CheckPillKind, LucideIcon> = { next: RefreshCw, closes: Clock };

/** ⚠️ ONE PILL for every card that says what VESTA does at a time (owner, 2026-10-23: an open issue's and a cleared
 *  fault's alike): its kind's icon and when, its words on hover. Which kind is the card's data, never its caller's. */
export function CheckPill({ kind, when, tip }: { kind: CheckPillKind; when: string; tip: string }) {
  const Icon = CHECK_ICON[kind];
  return (
    <Tip text={tip}>
      <span className="fm-entity-chip fm-chip-static fm-record-check" aria-label={tip}>
        <Icon size={12} aria-hidden="true" />{when}
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

/** ⚠️ THE DEVICE'S PILL OPENS ITS WINDOW, on a ticket and on an opened issue alike (owner, 2026-11-01: a tap on a card
 *  now opens and folds it, so this is the way to its device); a device no longer known, its name alone. */
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

/** A card's line of pills, folded or whole: its room on the left, its state on the right (owner, 2026-11-01); nothing
 *  with neither. */
function CardPillLine({ room, status }: { room?: string; status: readonly RecordStatus[] }) {
  if (!room && status.length === 0) return null;
  return (
    <span className="card-pill-line">
      {room && <Pill text={room} />}
      {status.length > 0 && (
        <span className="card-pill-status">{status.map((s) => <StatusPill key={s.text} {...s} />)}</span>
      )}
    </span>
  );
}

export default function RecordCard({ title, status, lead, titlePills, room, when, check, pills, notes, body, folded, photoIds,
  documentIds, amount, actions, erase, onOpen, framed = true, tone }: RecordCardProps) {
  const whole = folded === undefined;
  const inside = (
    <>
      <div className="fm-record-head">
        {lead && <span className="fm-record-lead">{lead}</span>}
        <div className="fm-row-title">
          <strong>{title}</strong>
          {titlePills}
        </div>
        {when && <Pill text={when} className="fm-record-check" />}
        {whole && check && <CheckPill kind={check.kind} when={check.when} tip={check.tip} />}
      </div>
      <CardPillLine room={room} status={[status ?? []].flat()} />
      {/* its text the card's width (its cost beside it), its buttons under it on the right (owner, 2026-10-29) */}
      <div className="fm-record-body">
        <div className="fm-row-main">
          {folded?.map((line, i) => <span key={i} className="fm-card-folded">{line}</span>)}
          {whole && pills && <RecordMeta>{pills}</RecordMeta>}
          {whole && (body ?? <RecordNotes notes={notes ?? []} />)}
          {whole && (photoIds?.length ?? 0) > 0 && <EvidenceRow photoIds={photoIds!} disabled />}
          {/* a report kept with it (the VESTA Agent's investigation): opens on the iPad, offline */}
          {whole && (documentIds?.length ?? 0) > 0 && (
            <div className="fm-documents">
              {documentIds!.map((id, i) => (
                <a key={id} className="fm-document-link" href={documentUrl(id)} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}>
                  <FileText size={15} aria-hidden="true" />
                  {documentIds!.length > 1 ? `Investigation report ${i + 1}` : "Investigation report"}
                </a>
              ))}
            </div>
          )}
        </div>
        {amount && <span className="fm-amount">{amount}</span>}
        {/* a press on a button is the button's: never the card's hold-to-erase, never its tap-to-open */}
        {actions && (
          <div className="fm-record-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
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
