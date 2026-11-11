// src/components/fm/RecordCard.tsx
// THE card of every Cockpit list — an open issue in the Inbox, a notification or a report, a ticket, a closed one, a
// scheduled task, a spend line, a piece of work done, a readiness check, a saved document (owner, 2026-10-14/15: "the
// same style as any other card, fully re-using the same code"). Tapping it opens it (`onOpen`); holding it erases it when
// it can be erased (`erase`: ErasableRow, superadmin) — a scheduled task is removed with its own bin instead (`bin`).
//
// ⚠️ ONE CARD, NOT FOUR (architecture review, 2026-10-15): the Overview, Schedule and Spend each drew their own, so a
// layout request ("buttons inside, on the right", "a note never runs out of the card") was made up to four times.
//
// ⚠️ NAME ON TOP, STATE FIRST (owner, 2026-11-05: the "Status on top" card, six rules, every kind of card alike; then
// the second card the same day: the strip names the thing, the card's first line says where it stands):
//   1. the strip, the card's top band in its status colour: its source icons (`lead`), its alert's name (`number`), the
//      thing's name (`title`: a device, a ticket, a task, a check, a notification's first sentence), its time at the
//      right (`when`). The name wraps to two lines at most, then "…"; the icons, the chip and the time never shrink and
//      stay on its first line. A card with nothing to say still has its strip and its time. A Settings card's remove is
//      a small icon at the strip's right end (`remove`: a bin or an ✕, owner 2026-11-06), never a word in its bar.
//   2. the card's first line says where it stands (`status`, several joined " · "), bold, in its tone's colour, its
//      (i) after it (`statusTip`: a Watch card's "Closes 15:06"), and at its right, under the strip's time, when VESTA
//      looks again (`check`: the next-check pill, owner 2026-11-06); a card with neither has no such line;
//   3. one quiet line: its device (`device`), its room, its tags (`pills`), " · " between them;
//   4. its words (`body` or `notes`), photos and cost;
//   5. who moved it, one quiet line (`who`): never its time or its stage again when the card says them;
//   6. the bar along its bottom edge (ActionsRow): every button a segment, the main action first and green.
// A card of several problems (an Inbox device with two) draws each as a part (`parts`): its header line (its icons, its
// state, its time), its words, who moved it, its own bar; the card's first line says how many. One part is the card itself.
//
// `framed`: a card of its own (the default) — or a record inside a card holding several (a ticket taken on for several
// faults of one device: RecordGroup). `tone`: the strip's colour when its status says none (fm/tone's
// toneClass), with any other class of the frame (a fault being confirmed, the card a warning opened on).
//
// ⚠️ ONE FOLD (owner, 2026-11-01): `folded`, a notification's or a report's until tapped: its caller hands its card whole
// and this one place swaps its text for that cut line, so no card can fold its own way.

import type { ReactNode } from "react";
import { RefreshCw, Trash2, UserRound } from "lucide-react";
import Tip from "@/components/common/Tip";
import InfoTip from "@/components/common/InfoTip";
import BinButton from "@/components/common/BinButton";
import IconButton from "@/components/common/IconButton";
import { useAskFirst } from "@/hooks/useAskFirst";
import ErasableRow from "./ErasableRow";
import EvidenceRow from "./EvidenceRow";
import { RecordNotes } from "./RecordMeta";
import { PageLink } from "@/components/messages/AnnouncementContent";

/** A Settings card's remove, a small round bin at the right of its strip (owner, 2026-11-06: ONE remove icon on every
 *  card, the bin; it had been an ✕ on a card taking a thing off a list). `label` is its tooltip and its accessible
 *  name, saying what goes ("Delete the group Kitchen Temperature", "Take Back Door off Asleep between reports"). */
export interface CardRemove { label: string; run: () => void }

/** ⚠️ A CARD'S BIN ASKS FIRST (owner, 2026-11-10: a task's bin and a saved document's deleted at one press, nothing to
 *  take it back): the bin at the end of its bar; pressed, the bar becomes its question (CardAsk) and the second press
 *  removes. `label` names what goes ("Remove Generator service"), `question` says what is kept. */
export interface CardBin { label: string; question: string; confirmLabel?: string; run: () => unknown }

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
  /** Its own check, a pill on its header before its time (a problem watched live on a card whose pill says a fault's). */
  check?: { pill: string; tip: string };
  text?: ReactNode;
  who?: string | null;
  actions?: ReactNode;
}

export interface RecordCardProps {
  /** What it is, named in its strip (a link when it opens something: an issue's device, .fm-title-link). */
  title: ReactNode;
  /** Where it stands, the card's first line (several joined " · "); the strip's colour is the worst of their tones. */
  status?: RecordStatus | RecordStatus[];
  /** What its status means, in words: an (i) after it on its first line (a Watch card's "Closes 15:06"). */
  statusTip?: string;
  /** Its source icons, first in its strip. */
  lead?: ReactNode;
  /** Its alert's name ("#91-P1"), a small chip in its strip before its name. */
  number?: string;
  /** The device a record names, first on its quiet line: a link that opens it (DeviceChip). */
  device?: ReactNode;
  /** Its room, quiet text on its quiet line: every card that shows a room. */
  room?: string;
  /** Its next check: a pill at the right of its first line, under the strip's time, its words `pill` ("next check
   *  within 5min", "checked live"), `tip` on hover (CheckPill). */
  check?: { pill: string; tip: string };
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
  /** Its problems, when it holds several (an Inbox device's): one part each, under its state and quiet line. */
  parts?: CardPart[];
  actions?: ReactNode;
  /** Settings and Advanced Settings only: what takes the record away, an icon at its strip's right (never a word in
   *  its bar). The Cockpit's cards never pass it (tests/oracles/settings_cards.mjs). */
  remove?: CardRemove;
  /** A Cockpit record removed by its own bin (a task, a saved document): the last button of its bar, asking first. */
  bin?: CardBin;
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

/** ⚠️ A CARD'S QUESTION TAKES ITS BAR (owner, 2026-11-05): "Close this ticket? Nothing was done, …" on a line of
 *  its own, then the bar [the main action][Cancel], the main action first as everywhere on the card. */
export function CardAsk({ question, icon, confirmLabel, onConfirm, onCancel }: {
  question: ReactNode; icon?: ReactNode; confirmLabel: ReactNode;
  onConfirm: () => void | Promise<void>; onCancel: () => void;
}) {
  return (
    <>
      <div className="fm-record-ask">{icon}<span>{question}</span></div>
      <button type="button" className="btn fm-bar-main" onClick={() => { void onConfirm(); }}>{confirmLabel}</button>
      <button type="button" className="btn" onClick={onCancel}>Cancel</button>
    </>
  );
}

/** ⚠️ ONE WAY TO SAY WHEN VESTA LOOKS AGAIN (owner, 2026-10-23: an open issue's and a cleared fault's alike; 2026-11-01:
 *  the refresh icon, so a time on a card is plainly its next check; 2026-11-06: a pill, the app's own (Pill's look), at
 *  the right of the card's first line, under the strip's time; it was quiet text on the quiet line): its words on hover. */
export function CheckPill({ pill, tip }: { pill: string; tip: string }) {
  return (
    <Tip text={tip}>
      <span className="fm-entity-chip fm-chip-static fm-record-check" aria-label={tip}>
        <RefreshCw size={12} aria-hidden="true" />{pill}
      </span>
    </Tip>
  );
}

/** ⚠️ ONE PILL FOR WHAT A CARD SAYS OF ITSELF (architecture review round 13, 2026-11-01): the Spend tab's device pill's
 *  look; on a card's quiet line it is quiet text (07-facility.css). */
export function Pill({ text }: { text: string }) {
  return <span className="fm-entity-chip fm-chip-static">{text}</span>;
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

/** The words of where it stands, several joined " · ", its (i) after them: a card's first line, a part's header. */
function StateWords({ status, tip }: { status: readonly RecordStatus[]; tip?: string }) {
  const words = status.map((s) => s.text).join(" · ");
  return (
    <>
      {words && <span className="fm-record-status">{words}</span>}
      {words && tip && <InfoTip label={tip}>{tip}</InfoTip>}
    </>
  );
}

/** ⚠️ A SETTINGS CARD'S REMOVE (owner, 2026-11-06: "a small icon button at the top right of the card's band", where a
 *  Cockpit card shows its time): the app's lone icon button, its 44px touch target outside its glyph so the strip
 *  keeps its height (07-facility.css); a press is the button's, never the card's tap or hold. */
function RemoveButton({ label, run }: CardRemove) {
  return (
    <IconButton danger label={label} className="fm-record-remove"
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); run(); }}>
      <Trash2 size={16} aria-hidden="true" />
    </IconButton>
  );
}

/** A card's strip: its icons, its alert's name, the thing's name, its time, a Settings card's remove. */
function CardStrip({ lead, number, name, when, tone, remove }: {
  lead?: ReactNode; number?: string; name: ReactNode; when?: string; tone: StripTone; remove?: CardRemove;
}) {
  return (
    <div className={`fm-record-strip strip-${tone}`}>
      {lead && <span className="fm-record-lead">{lead}</span>}
      {number && <span className="fm-record-number">{number}</span>}
      {name !== undefined && name !== null && name !== "" && <span className="fm-record-name">{name}</span>}
      {when && <span className="fm-record-when">{when}</span>}
      {remove && <RemoveButton {...remove} />}
    </div>
  );
}

/** A card's first line: where it stands, in its tone's colour (rule 2), its (i) after it, its next check a pill at
 *  its right; `children`: the first of its words after its state, " · " between (the head a notice draws: RecordHead).
 *  None when it says nothing. */
function StateLine({ status, tip, check, tone, children }: {
  status: readonly RecordStatus[]; tip?: string; check?: { pill: string; tip: string }; tone: StripTone; children?: ReactNode;
}) {
  const said = status.some((s) => s.text);
  if (!said && !check && !children) return null;
  return (
    <div className={`fm-record-state strip-${tone}`}>
      <StateWords status={status} tip={tip} />
      {children && <span className="fm-record-words">{said && " · "}{children}</span>}
      {check && <CheckPill {...check} />}
    </div>
  );
}

/** ⚠️ A CARD'S HEAD, WHEREVER THE CARD IS TOLD (UI scan, 2026-11-10; the rules: "the same name and the same Status
 *  everywhere"): its strip (its icons, its alert's name, its name, its time) and its first line (where it stands, then
 *  `children`: the first of its words), by the card's own pieces. The alert's notice over the villa draws it
 *  (hud/AnnouncementNotice): it had a bell, a title and a line of its own in the app's accent, an alarm and a doorbell
 *  alike. `tone`: the strip's colour (stripTone), the one its notice wears. */
export function RecordHead({ title, lead, number, when, status, statusTip, tone, children }: {
  title: ReactNode; lead?: ReactNode; number?: string; when?: string;
  status: readonly RecordStatus[]; statusTip?: string; tone: StripTone; children?: ReactNode;
}) {
  return (
    <>
      <CardStrip lead={lead} number={number} name={title} when={when} tone={tone} />
      <StateLine status={status} tip={statusTip} tone={tone}>{children}</StateLine>
    </>
  );
}

/** A part's header line, in a card of several problems: its icons, its alert's name, its state, its check, its time. */
function PartHead({ lead, number, status, check, when, tone }: {
  lead?: ReactNode; number?: string; status: readonly RecordStatus[]; check?: { pill: string; tip: string }; when?: string; tone: StripTone;
}) {
  return (
    <div className={`fm-record-part-head strip-${tone}`}>
      {lead && <span className="fm-record-lead">{lead}</span>}
      {number && <span className="fm-record-number">{number}</span>}
      <StateWords status={status} />
      {check && <CheckPill {...check} />}
      {when && <span className="fm-record-when">{when}</span>}
    </div>
  );
}

/** A bar ending in a bin that asks first: the two steps of every switch that asks (hooks/useAskFirst), so no card
 *  keeps an "am I asking" of its own. Pressed, the bar becomes the question; the second press removes. */
function BinnedBar({ bin, children }: { bin: CardBin; children: ReactNode }) {
  const { asking, request, confirm, cancel } = useAskFirst(
    { question: bin.question, confirmLabel: bin.confirmLabel ?? "Remove" }, () => { void bin.run(); });
  return (
    <ActionsRow>
      {asking
        ? <CardAsk question={asking.question} icon={<Trash2 size={16} aria-hidden="true" />}
            confirmLabel={asking.confirmLabel} onConfirm={confirm} onCancel={cancel} />
        : <>{children}<BinButton label={bin.label} onPress={request} /></>}
    </ActionsRow>
  );
}

export default function RecordCard({ title, status, statusTip, lead, number, device, room, when, check, pills,
  notes, body, folded, photoIds, pages, amount, who, parts, actions, remove, bin, erase, onOpen, framed = true, tone }: RecordCardProps) {
  const whole = folded === undefined;
  const statuses = [status ?? []].flat();
  // one problem is the card itself: its words, who line and buttons are the card's
  const single = parts?.length === 1 ? parts[0] : undefined;
  const several = parts && parts.length > 1 ? parts : [];
  const text = single ? single.text : body;
  const whoSaid = single ? single.who : who;
  const bar = (pages?.length ?? 0) > 0 || actions || single?.actions || bin;
  // the main action first (rule 6), the pages after the buttons (a bin, last: BinnedBar)
  const buttons = (
    <>
      {single?.actions}
      {actions}
      {pages?.map((p) => <PageLink key={p.id} page={p.id}
        label={p.short ? <><span className="work-long">{p.label}</span><span className="work-short">{p.short}</span></> : p.label} />)}
    </>
  );
  const toneWords = (tone ?? "").split(" ").filter(Boolean);
  const frame = toneWords.filter((w) => !w.startsWith("tone-")).join(" ");
  const strip = stripTone(statuses, toneWords.find((w) => w.startsWith("tone-")));
  const inside = (
    <>
      <CardStrip lead={lead} number={number} name={title} when={when} tone={strip} remove={remove} />
      <div className="fm-record-main">
        <StateLine status={statuses} tip={statusTip} check={check} tone={strip} />
        {/* its quiet line: " · " between its pieces (07-facility.css), nothing drawn when it has none */}
        {(device || room || pills) && (
          <div className="fm-record-meta">
            {device}
            {room && <span>{room}</span>}
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
          <PartHead lead={p.lead} number={p.number} status={p.status ?? []} check={p.check} when={p.when} tone={stripTone(p.status ?? [], p.tone)} />
          {(p.text || p.who) && <div className="fm-record-part-text">{p.text}<WhoLine who={p.who} /></div>}
          {p.actions && <ActionsRow>{p.actions}</ActionsRow>}
        </section>
      ))}
      {bar && (bin ? <BinnedBar bin={bin}>{buttons}</BinnedBar> : <ActionsRow>{buttons}</ActionsRow>)}
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
