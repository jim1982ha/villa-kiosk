// src/components/fm/RecordCard.tsx
// THE card of every Cockpit list — an open issue in the Inbox, a notification or a report, a ticket, a closed one, a
// scheduled task, a spend line, a piece of work done, a readiness check, a saved document (owner, 2026-10-14/15: "the
// same style as any other card, fully re-using the same code"). Tapping it opens it (`onOpen`); holding it erases it when
// it can be erased (`erase`: ErasableRow, superadmin) — a scheduled task is removed with its own bin instead.
//
// ⚠️ ONE CARD, NOT FOUR (architecture review, 2026-10-15): the Overview, Schedule and Spend each drew their own, so a
// layout request ("buttons inside, on the right", "a note never runs out of the card") was made up to four times.
//
// ⚠️ STATUS ON TOP (owner, 2026-11-05: the "Status on top" card, six rules, every kind of card alike):
//   1. the strip, the card's top band in its status colour: its source icons (`lead`), its alert's name (`number`), where
//      it stands (`status`, several joined " · "), its time at the right (`when`). It never wraps: the words give way, the
//      name and the time never do. A card with nothing to say still has its strip and its time.
//   2. the title names the thing (`title`, `titlePills` after it); the status is never said again under it;
//   3. one quiet line: its device (`device`), its room, its next check (`check`), its tags (`pills`), " · " between them;
//   4. its words (`body` or `notes`), photos and cost;
//   5. who moved it, one quiet line (`who`): never its time or its stage again when the strip says them;
//   6. the bar along its bottom edge (ActionsRow): every button a segment, the main action first and green.
// A card of several problems (an Inbox device with two) draws each as a part (`parts`): its header line (its icons, its
// state, its time), its words, who moved it, its own bar; its strip says how many. One part is the card itself.
//
// `framed`: a card of its own (the default) — or a record inside a card holding several (a ticket taken on for several
// faults of one device: RecordGroup). `tone`: the strip's colour when its status says none (fm/tone's
// toneClass), with any other class of the frame (a fault being confirmed, the card a warning opened on).
//
// ⚠️ ONE FOLD (owner, 2026-11-01): `folded`, a notification's or a report's until tapped: its caller hands its card whole
// and this one place swaps its text for that cut line, so no card can fold its own way.

import type { ReactNode } from "react";
import { RefreshCw, UserRound } from "lucide-react";
import Tip from "@/components/common/Tip";
import InfoTip from "@/components/common/InfoTip";
import ErasableRow from "./ErasableRow";
import EvidenceRow from "./EvidenceRow";
import { RecordNotes } from "./RecordMeta";
import { PageLink } from "@/components/messages/AnnouncementContent";

/** A card's state: its words and its tone's class (fm/tone pillClass, ACCENT_PILL, QUIET_PILL). */
export interface RecordStatus { text: string; tone: string }

/** One problem of a card holding several (an Inbox device's): its own header, words, who line and bar. */
export interface CardPart {
  key: string;
  lead?: ReactNode;
  status?: readonly RecordStatus[];
  number?: string;
  when?: string;
  /** Its header's colour when its status says none (as the card's `tone`). */
  tone?: string;
  text?: ReactNode;
  who?: string | null;
  actions?: ReactNode;
}

export interface RecordCardProps {
  title: ReactNode;
  /** Where it stands, said in its strip (several joined " · "); the strip's colour is the worst of their tones. */
  status?: RecordStatus | RecordStatus[];
  /** What its status means, in words: an (i) after it in the strip (a Watch card's "Closes 15:06"). */
  statusTip?: string;
  /** Its source icons, first in its strip. */
  lead?: ReactNode;
  /** Its alert's name ("#91-P1"), a small chip in its strip before its status. */
  number?: string;
  /** Pills right after the title, on its line (a spend's device, a readiness check's way to its place). */
  titlePills?: ReactNode;
  /** The device a record names, first on its quiet line: a link that opens it (DeviceChip). */
  device?: ReactNode;
  /** Its room, quiet text on the line under the title: every card that shows a room. */
  room?: string;
  /** Its next check, after the room: the refresh icon and when, `tip` on hover (CheckPill). */
  check?: { when: string; tip: string };
  /** Its tags on that line ("guest report", "by VESTA Agent", a task's interval…). */
  pills?: ReactNode;
  /** When, at the right of its strip, on every card (owner, 2026-11-01). */
  when?: string;
  notes?: (string | undefined | null)[];
  /** Lines of its own, in place of the notes (an open issue's words, a notification's). */
  body?: ReactNode;
  /** Folded: this line, cut with "…", stands for its text; undefined: the card whole. */
  folded?: string;
  photoIds?: string[];
  /** VESTA's pages kept with it (a report's, a ticket's investigation), opened on the iPad, offline: in its bar after
   *  its buttons, folded or whole (architecture review 19 #3); `short`, its word on a narrow card ("Report"). */
  pages?: { id: string; label: string; short?: string }[];
  /** A cost, formatted, at the right under its words. */
  amount?: string;
  /** Who last moved it ("Opened by Wayan", "By VESTA Agent"): one quiet line under its words (faultNotes.moveWho). */
  who?: string | null;
  /** Its problems, when it holds several (an Inbox device's): one part each, under its title and quiet line. */
  parts?: CardPart[];
  actions?: ReactNode;
  erase?: { title: string; detail: string; run: (token: string) => Promise<unknown> };
  onOpen?: () => void;
  framed?: boolean;
  tone?: string;
}

/** A strip's colour: the worst of its states' tones, else the card's tone, else grey. ⚠️ ONE RULE FOR EVERY STRIP
 *  (owner, 2026-11-05): red act now, amber a fault, green handled (a ticket in progress, a watch, all well), grey
 *  quiet (a device out of contact, anything closed). Pure: a check drives it. */
export type StripTone = "danger" | "warn" | "ok" | "neutral";
const TONE_OF_CLASS: Record<string, StripTone> = {
  danger: "danger", warn: "warn", accent: "ok", ok: "ok", quiet: "neutral", lost: "neutral",
};
const STRIP_RANK: StripTone[] = ["danger", "warn", "ok", "neutral"];
const toneOf = (cls: string | undefined): StripTone | undefined => {
  const m = /(?:^|\s)tone-(\w+)/.exec(cls ?? "");
  return m ? TONE_OF_CLASS[m[1]] : undefined;
};
export function stripTone(status: readonly RecordStatus[], tone?: string): StripTone {
  const said = status.map((s) => toneOf(s.tone)).filter((t): t is StripTone => !!t);
  if (said.length) return STRIP_RANK.find((t) => said.includes(t))!;
  return toneOf(tone) ?? "neutral";
}

/** ⚠️ A CARD'S BAR (owner, 2026-11-05, rule 6): its buttons joined along its bottom edge, equal segments split by
 *  hairlines, at least a finger tall, each its icon and its label (its short word on a narrow card: 07-facility.css).
 *  Every card's buttons go in this one bar, whatever they are: a problem's work buttons (WorkButtons, the main action
 *  first and green), a page, a notification's buttons, a task's Pause and bin. */
export function ActionsRow({ children }: { children: ReactNode }) {
  return (
    // a press on a button is the button's: never the card's hold-to-erase, never its tap-to-open
    <div className="fm-record-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/** ⚠️ ONE CARD HOLDING SEVERAL RECORDS (a ticket taken on for several faults of one device: TicketsTab): one frame, its
 *  records (each a RecordCard with `framed={false}`) divided by a hairline, its bar after all of them. Drawn here with
 *  every other part of a card (architecture review, 2026-11-05: the Tickets tab drew this frame itself). */
export function RecordGroup({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="fm-record-card">
      <div className="fm-record-group">{children}</div>
      {actions && <ActionsRow>{actions}</ActionsRow>}
    </div>
  );
}

/** ⚠️ A CARD'S QUESTION TAKES ITS BAR (owner, 2026-11-05): "Done? VESTA checks it again before it closes." on a line of
 *  its own, then the bar [the main action][Cancel], the main action first as everywhere on the card. */
export function CardAsk({ question, icon, confirmLabel, onConfirm, onCancel }: {
  question: ReactNode; icon?: ReactNode; confirmLabel: ReactNode;
  onConfirm: () => void | Promise<void>; onCancel: () => void;
}) {
  return (
    <>
      <div className="fm-record-ask">{icon}<span>{question}</span></div>
      <button type="button" className="btn ghost fm-bar-main" onClick={() => { void onConfirm(); }}>{confirmLabel}</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
    </>
  );
}

/** ⚠️ ONE WAY TO SAY WHEN VESTA LOOKS AGAIN (owner, 2026-10-23: an open issue's and a cleared fault's alike; 2026-11-01:
 *  the refresh icon, so a time on a card is plainly its next check): quiet text on the card's line, its words on hover. */
export function CheckPill({ when, tip }: { when: string; tip: string }) {
  return (
    <Tip text={tip}>
      <span className="fm-record-check" aria-label={tip}>
        <RefreshCw size={12} aria-hidden="true" />next check {when}
      </span>
    </Tip>
  );
}

/** ⚠️ ONE PILL FOR WHAT A CARD SAYS OF ITSELF (architecture review round 13, 2026-11-01): the Spend tab's device pill's
 *  look; on a card's quiet line it is quiet text (07-facility.css). */
export function Pill({ text, className = "" }: { text: string; className?: string }) {
  return <span className={`fm-entity-chip fm-chip-static${className ? ` ${className}` : ""}`}>{text}</span>;
}

/** The device a ticket names: its name, a link that opens its window; a device no longer known, its name alone. */
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

/** Who moved it, one quiet line with a person (rule 5). */
export function WhoLine({ who }: { who?: string | null }) {
  if (!who) return null;
  return <div className="fm-record-who"><UserRound size={14} aria-hidden="true" /><span>{who}</span></div>;
}

/** A card's strip, or a part's header line (`part`): icons, alert name, states, the (i), the time. */
function CardStrip({ lead, number, status, tip, when, tone, part }: {
  lead?: ReactNode; number?: string; status: readonly RecordStatus[]; tip?: string; when?: string; tone: StripTone; part?: boolean;
}) {
  const words = status.map((s) => s.text).join(" · ");
  return (
    <div className={`${part ? "fm-record-part-head" : "fm-record-strip"} strip-${tone}`}>
      {lead && <span className="fm-record-lead">{lead}</span>}
      {number && <span className="fm-record-number">{number}</span>}
      {words && <span className="fm-record-status">{words}</span>}
      {tip && <InfoTip label={tip}>{tip}</InfoTip>}
      {when && <span className="fm-record-when">{when}</span>}
    </div>
  );
}

export default function RecordCard({ title, status, statusTip, lead, number, titlePills, device, room, when, check, pills,
  notes, body, folded, photoIds, pages, amount, who, parts, actions, erase, onOpen, framed = true, tone }: RecordCardProps) {
  const whole = folded === undefined;
  const statuses = [status ?? []].flat();
  // one problem is the card itself: its words, who line and buttons are the card's
  const single = parts?.length === 1 ? parts[0] : undefined;
  const several = parts && parts.length > 1 ? parts : [];
  const text = single ? single.text : body;
  const whoSaid = single ? single.who : who;
  const bar = (pages?.length ?? 0) > 0 || actions || single?.actions;
  const toneWords = (tone ?? "").split(" ").filter(Boolean);
  const frame = toneWords.filter((w) => !w.startsWith("tone-")).join(" ");
  const inside = (
    <>
      <CardStrip lead={lead} number={number} status={statuses} tip={statusTip} when={when}
        tone={stripTone(statuses, toneWords.find((w) => w.startsWith("tone-")))} />
      <div className="fm-record-main">
        <div className="fm-record-head">
          <div className="fm-row-title">
            <strong>{title}</strong>
            {titlePills}
          </div>
        </div>
        {/* its quiet line: " · " between its pieces (07-facility.css), nothing drawn when it has none */}
        {(device || room || check || pills) && (
          <div className="fm-record-meta">
            {device}
            {room && <span>{room}</span>}
            {check && <CheckPill {...check} />}
            {pills}
          </div>
        )}
        {!whole && <span className="fm-card-folded">{folded}</span>}
        {whole && (text ?? <RecordNotes notes={notes ?? []} />)}
        {whole && (photoIds?.length ?? 0) > 0 && <EvidenceRow photoIds={photoIds!} disabled />}
        {amount && <div className="fm-record-foot"><span className="fm-amount">{amount}</span></div>}
        {whole && <WhoLine who={whoSaid} />}
      </div>
      {whole && several.map((p) => (
        <section key={p.key} className="fm-record-part">
          <CardStrip part lead={p.lead} number={p.number} status={p.status ?? []} when={p.when} tone={stripTone(p.status ?? [], p.tone)} />
          {(p.text || p.who) && <div className="fm-record-part-text">{p.text}<WhoLine who={p.who} /></div>}
          {p.actions && <ActionsRow>{p.actions}</ActionsRow>}
        </section>
      ))}
      {bar && (
        <ActionsRow>
          {/* the main action first (rule 6), the pages after the buttons */}
          {single?.actions}
          {actions}
          {pages?.map((p) => <PageLink key={p.id} page={p.id}
            label={p.short ? <><span className="work-long">{p.label}</span><span className="work-short">{p.short}</span></> : p.label} />)}
        </ActionsRow>
      )}
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
  return framed ? <div className={`fm-record-card${frame ? ` ${frame}` : ""}`}>{record}</div> : record;
}
