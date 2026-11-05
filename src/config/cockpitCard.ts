// src/config/cockpitCard.ts
// ONE COCKPIT CARD, AS IT IS DRAWN (architecture review scan 1, 2026-10-19): its title and room, the icons before its
// name, its "Next check" and the date and time behind it, its buttons, and each problem's line — words, icons, what
// last happened on Telegram. Pure; IssueCard draws exactly this, a check reads it by value.
//
// ⚠️ FIVE CALLS, ONE CARD: the page asked attention for a line's words (twice: once for its hover text), its icons,
// its buttons and the card's, and faultTiming for its next check, and worked out a line's latest Telegram note itself
// (`item.move ?? item.fault?.move`) — each reading the shape the grouping leaves behind (`fault`, `twins`). The
// "one line per problem" bugs of the week (10-13 a repeated icon, 10-17 "(6 times)", 10-18 "UNLOCKED — … UNLOCKED")
// were each fixed in one of those calls; the page now knows none of them.
//
// ⚠️ AND THE FIVE CALLS ARE THIS FILE'S OWN (architecture review, 2026-10-19): attention still exported them, and the
// checks read them one by one — a line's words could be right in a check and wrong on the card. attention groups the
// problems; how a card SAYS them lives here only, and a check reads what cockpitCard returns.

import { ACCENT_PILL, QUIET_PILL, pillClass } from "@/fm/tone";
import type { RecordStatus } from "@/components/fm/RecordCard";
import type { AgentCadence } from "@/agent/agentApi";
import { checkPill } from "@/fm/faultTiming";
import { closedActions, helpAsked, overviewActions, workRecord, type WorkAction, type WorkRecord } from "@/fm/deviceWork";
import type { HelpAsked } from "@/fm/fmEngine";
import type { IssueSource } from "@/fm/issueSource";
import { clockTime, docDate, momentText } from "@/utils/dateText";
import { sinceText } from "./presence";
import { closedFaults, closedTold, confirmParts, type ConfirmingFault } from "@/fm/faultConfirm";
import { STAGE_WORDS, alertNumberOf, faultAlertLabel, faultBegan, faultName } from "@/fm/fmEngine";
import { faultMove, moveState, type FaultMove } from "@/fm/faultNotes";
import type { FmData, FmTicket } from "@/fm/fmTypes";
import type { HassEntity } from "@/types/ha.types";
import { alertStage, statusWords, type Announcement } from "@/messages/announcements";
import { labelOf } from "./EntityMap";
import { recordEntity, type VillaDevices } from "./deviceGroups";
import { attentionSeverity, cardDevice, cardHead, type AttentionGroup, type AttentionItem, type AttentionSeverity } from "./attention";

/** The records of one line — its fault, or the fault folded onto its live state, with their copies. A copy shares its
 *  line's standing Need help: one press on the card asks about every record of it, the copies included. */
function itemRecords(i: AttentionItem): WorkRecord[] {
  const f = i.kind === "fault" ? i : i.fault;
  return f ? [f.ticketId, ...(f.twins ?? [])].flatMap((id) => (id
    ? [{ id, stage: f.stage ?? "fault", ...(f.help ? { help: f.help } : {}), ...(f.helpInPill ? { helpInPill: f.helpInPill } : {}) }] : [])) : [];
}

/** ⚠️ EACH PROBLEM HAS ITS OWN BUTTONS (owner, 2026-11-01: "for each issue of a potential merged cards", Edit Ticket on
 *  the fault with a ticket, Open Ticket on the one without; it was one row for the card, its Done closing all of it):
 *  on the records of its line, or its device when it holds none (deviceWork.overviewActions). */
const lineWork = (records: WorkRecord[], device: string | undefined): Pick<CardLine, "records" | "actions" | "asked"> =>
  ({ records, actions: overviewActions(records, device), asked: helpAsked(records) });

/** A problem's line inside ITS row: under a device, what attentionLine says ("Unlocked", "Entrance door unlocked");
 *  in a row that is the problem itself (no device), nothing: its title is the row's (its stage is its state line's,
 *  faultNotes.moveState). Every row shows its problems this way, one or several. */
function attentionLineIn(group: AttentionGroup, item: AttentionItem): string {
  return group.key.startsWith("device:") ? attentionLine(item) : "";
}

/** The word of a device's own state that a line says BESIDE the fault folded onto it, the fault not saying it already
 *  ("Missing" before an unlocked-door alert); undefined when there is none (no fault, or its title says it, or an
 *  "Unavailable" its fault is about: mergeFaults folds an offline device's fault onto that line). */
function stateBesideFault(item: AttentionItem): string | undefined {
  if (!item.fault) return undefined;
  const word = item.detail ?? "";
  const said = !word || (item.kind === "unavailable" && word === "Unavailable") || saysWord(item.fault.title, word);
  return said ? undefined : word;
}

/** ⚠️ A CARD'S ICONS SAY EVERY KIND OF PROBLEM IT HOLDS (owner, 2026-10-30: the onsen pump's row showed only #96's
 *  alert while its card also held the night check's finding — "i expect to see the existing icon + the moon one"):
 *  each source once, in its lines' order (the most serious line's first), in the colour of the first line saying it.
 *  The list's row and the card's head both draw this. null for a card with no line. */
function cardSources(items: readonly AttentionItem[]): LineSources | null {
  const out: LineSources = { sources: [], severities: [] };
  for (const s of items.map(lineSources)) {
    s.sources.forEach((src, i) => {
      if (out.sources.includes(src)) return;
      out.sources.push(src);
      out.severities.push(s.severities[i] ?? s.severities[0]);
    });
  }
  return out.sources.length ? out : null;
}

/** Where an OPEN card draws its icons, from its lines in the order drawn (after othersFirst): one place decides it.
 *  - Every line of one kind (or one line): the icons before the card's name (its `lead`), none on the lines.
 *  - Lines of several kinds: each line its own icons, none before the name — each icon drawn once, beside what it
 *    says.
 *  ⚠️ ONE PLACE FOR THE ICONS (owner, 2026-10-30, review round 4: three icon fixes in one afternoon — "a card's icons
 *  say every problem", "i see twice the same icons", "the icons appear outside the cards"): a line's icon was decided
 *  before the lines were put in their order, then patched three times (the first line's dropped for the name, given
 *  back to the alert drawn second, taken off the name, the emptied column padded). ⚠️ ONE ICON PER MEANING (owner,
 *  2026-10-13: "the icon is redundant"): a line never repeats an icon the name shows. Pure. */
export function cardIcons(card: Pick<CardView, "lead" | "lines">): {
  head: LineSources | null; lines: (LineSources | null)[];
} {
  // ⚠️ THE STRIP SAYS EVERY SOURCE, EACH PROBLEM ITS OWN (owner, 2026-11-05, the "Status on top" card): the card's strip
  // carries every kind of problem it holds (cardSources); a card of several problems draws each one's own icons in that
  // problem's header line, beside its state and its time. One problem: its icons are the strip's, none repeated.
  const owns = card.lines.map((l) => l.own ?? null);
  return { head: card.lead, lines: card.lines.length > 1 ? owns : owns.map(() => null) };
}

/** A line's source icons and the status colour of each (owner, 2026-10-14: the source as an icon, in place of the
 *  warning sign; two stacked when a line holds a device's live state and its fault). */
export interface LineSources { sources: IssueSource[]; severities: AttentionSeverity[] }
function lineSources(item: AttentionItem): LineSources {
  const own = { sources: [item.source ?? "live"], severities: [attentionSeverity(item)] } as LineSources;
  return item.fault ? { sources: [...own.sources, item.fault.source ?? "person"], severities: [...own.severities, attentionSeverity(item.fault)] } : own;
}

/** "(6 times)" after a line that stands for several identical records (foldTwins); "" for one. */
function timesSaid(item: AttentionItem): string {
  const n = 1 + (item.twins?.length ?? 0);
  return n > 1 ? ` (${n} times)` : "";
}

/** Does `title` already say `word` ("Laundry Room door unlocked" says "Unlocked"), or a phrase ("… is missing from the
 *  villa's system."), as whole words, whatever its case and its closing stop?
 *  ⚠️ THE ONE COMPARER OF "THIS TEXT ALREADY SAYS THAT" (architecture review round 16, 2026-11-03): a device's state beside
 *  its fault and a card's pills used whole words, an "Also:" line under an alert a plain substring, so a short "Open"
 *  line went as told by an alert saying "Reopened". stateBesideFault, othersFirst and issueAsTold's pills all ask this. */
export function saysWord(title: string, word: string): boolean {
  const w = norm(word);
  if (!w) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u")
    .test(title.toLowerCase());
}

/** One problem's line inside a device's row. A state needs no more than its
 *  word ("Unlocked", "Unavailable"); a fault or a schedule names itself, since
 *  its title is what is wrong, not the device ("Entrance door unlocked"). */
function attentionLine(item: AttentionItem): string {
  if (item.fault) {
    const fault = `${item.fault.title}${timesSaid(item.fault)}`;
    return fault.charAt(0).toUpperCase() + fault.slice(1);
  }
  return item.kind === "fault" || item.kind === "schedule" ? `${item.title}${timesSaid(item)}` : "";
}

/** ⚠️ A CARD'S STATE IS ITS PILLS, NEVER ITS WORDS (owner, 2026-11-01, option A): the Inbox wrote it three ways, "In
 *  progress: …", "Missing, #100-P1", "Unavailable", while Tickets and Schedule draw a status pill. Each distinct state
 *  of its problems, once: its device's own word its fault does not say (stateBesideFault: "Missing"), a state with no
 *  fault ("Unavailable", "Unlocked", a task's "Overdue"). A ticket's stage is said with them by how it was last moved
 *  (faultNotes.moveState, cardStrip). The line under them only ever says what is wrong (attentionLine, issueAsTold).
 *  Drawn in the card's strip (RecordCard). Pure. */
function cardStatuses(items: readonly AttentionItem[]): RecordStatus[] {
  const out = new Map<string, RecordStatus>();
  for (const s of items.flatMap(itemState)) out.set(s.text, s);
  return [...out.values()];
}

/** One problem's own state word, in its severity's colour: a device out of contact grey (owner, 2026-11-05: red act
 *  now, amber a fault, grey no contact, as the map's badges). [] for a fault, which names itself. */
function itemState(i: AttentionItem): RecordStatus[] {
  const word = i.fault ? stateBesideFault(i) : i.kind === "fault" ? undefined : i.detail;
  return word ? [{ text: word, tone: SEVERITY_PILL[attentionSeverity(i)] }] : [];
}

const SEVERITY_PILL: Record<AttentionSeverity, string> = { danger: pillClass("danger"), warn: pillClass("warn"), lost: QUIET_PILL };

/** How a card stands, for its colour and its place in Open issues: its worst problem's severity, or "handled" when
 *  every problem of it is a ticket someone took on. */
export type CardTone = AttentionSeverity | "handled";
const CARD_TONE_PILL: Record<CardTone, string> = { ...SEVERITY_PILL, handled: ACCENT_PILL };
/** ⚠️ OPEN ISSUES IN THEIR COLOUR'S ORDER (owner, 2026-11-05): red, then amber, then grey, then what is being handled. */
export const CARD_TONE_RANK: Record<CardTone, number> = { danger: 0, warn: 1, lost: 2, handled: 3 };

function cardTone(lead: LineSources | null, lines: readonly CardLine[]): CardTone {
  if (lines.length > 0 && lines.every((l) => l.records?.some((r) => r.stage === "ticket"))) return "handled";
  const sev = lead?.severities ?? [];
  return (["danger", "warn", "lost"] as const).find((t) => sev.includes(t)) ?? "warn";
}

/** ⚠️ WHAT A CARD'S STRIP SAYS (owner, 2026-11-05, the "Status on top" card): its alert's name ("#91-P1"), then where it
 *  stands: its states and, for one problem, how it was last moved (a ticket's stage, "Reopened", a close's word:
 *  faultNotes.moveState); "2 problems" in its worst colour when it holds several, each problem's own in its header line
 *  (lineStrip). `tone`: the colour when nothing is said. Pure. */
export function cardStrip(card: Pick<CardView, "lines" | "status" | "tone" | "look">): { status: RecordStatus[]; number?: string; tone: string } {
  const tone = CARD_TONE_PILL[card.tone ?? "warn"];
  if (card.lines.length > 1) return { status: [{ text: `${card.lines.length} problems`, tone }], tone };
  const lead = leadLine(card);
  const status = dedupe([...(card.status ?? []), ...(lead ? lineState(lead, tone, card.look) : [])]);
  return { status, tone, ...(lead?.alertLabel ? { number: lead.alertLabel } : {}) };
}

/** A problem's header line on a card of several: its own states and how it was last moved, its alert's name. Pure. */
export function lineStrip(line: CardLine): { status: RecordStatus[]; number?: string; tone: string } {
  const tone = CARD_TONE_PILL[cardTone(line.own ?? null, [line])];
  return { status: dedupe([...(line.state ?? []), ...lineState(line, tone)]), tone, ...(line.alertLabel ? { number: line.alertLabel } : {}) };
}

/** How a problem was last moved (a ticket's stage, "Reopened", a close's word: faultNotes.moveState), else where its
 *  alert stands as VESTA's message says it (toldState), else where its open fault stands (faultState). */
const lineState = (l: CardLine, tone: string, look?: CardView["look"]): RecordStatus[] => {
  const m = moveState(l.move);
  if (m) return [m];
  const told = toldState(l, tone, look);
  return told.length ? told : faultState(l, tone, look);
};

/** ⚠️ EVERY OPEN FAULT SAYS WHERE IT STANDS (owner, 2026-11-06: "House Pump Power", a maintenance check's fault nobody had
 *  moved, had no first line, its card starting with its quiet line): a fault's state came only from how it was last
 *  moved or from its alert's Status, and a fault nobody moved has neither. Nobody moved it: "New fault"; moved with no
 *  state of its own (a Need help, said by its who line): its stage's word ("Open"); in its card's colour (amber for a
 *  maintenance check's), from the one table of stage words (fmEngine.STAGE_WORDS). A live state with no record keeps
 *  its device's word (itemState); the Watch list and Closed say their own. Pure. */
function faultState(l: CardLine, tone: string, look?: CardView["look"]): RecordStatus[] {
  if (look || !l.records?.some((r) => r.stage === "fault")) return [];
  const words = STAGE_WORDS.fault;
  return [{ text: l.move ? words.card : words.unmoved ?? words.card, tone }];
}

/** ⚠️ AN ALERT'S CARD SAYS WHERE IT STANDS FIRST (architecture review 29, 2026-11-06): with nothing moved on its record,
 *  its card's state line was empty and its stage ("⚠️ New alert", Telegram's Status) a small line under its words,
 *  while every other card says its state first and the "(new)" of Telegram's title was dropped as "the card's state
 *  says it" (round 26). VESTA's Status, its mark read as the colour: the problem's while it is open, grey once over.
 *  Not on the Watch list, whose state is when it closes. Pure. */
function toldState(l: CardLine, tone: string, look?: CardView["look"]): RecordStatus[] {
  const words = look === "watched" || !l.told ? "" : statusWords(l.told.status);
  if (!words) return [];
  const over = ["watch", "closed"].includes(alertStage(l.told!) ?? "");
  return [{ text: words, tone: over ? QUIET_PILL : tone }];
}

/** VESTA's message of a problem as its words draw it: its Status said once, by the state line when that line says it
 *  (toldState), as Telegram says it once under "Status:". Pure. */
export function toldShown(l: CardLine, look?: CardView["look"]): Announcement | undefined {
  if (!l.told) return undefined;
  return !moveState(l.move) && toldState(l, "", look).length ? { ...l.told, status: "" } : l.told;
}
const dedupe = (all: RecordStatus[]) => all.filter((s, i) => all.findIndex((x) => x.text === s.text) === i);

/** ⚠️ A FAULT WAITING TO CLOSE SAYS SO (owner, 2026-10-21): a door locked at 14:38:50 was still a fault at 14:45 under
 *  "Next check: within 5 min" — the VESTA Agent closes it once it has stayed right for its clear wait, and nothing said
 *  it. "Locked since 14:38 · closes at about 14:49 if it stays locked"; its moment past: "at the next check". */
function closingText(c: AttentionItem["closing"], now: Date): string | null {
  if (!c) return null;
  const at = Date.parse(c.at);
  const when = at > now.getTime() ? `closes at about ${clockTime(at)}` : "closes at the next check";
  if (!c.word) return `Back to normal · ${when} if it stays so`;
  const said = sinceText(c.since ?? null, clockTime, docDate);
  const since = said ? ` since ${said}` : "";
  return `${c.word}${since} · ${when} if it stays ${c.word.toLowerCase()}`;
}

/** One problem's line inside the card. */
export interface CardLine {
  key: string;
  /** Its words ("Unlocked", "In progress: Back door stiff"); whole on hover. */
  text: string;
  /** The records it stands for, each with its stage; what its buttons act on. */
  records: WorkRecord[];
  /** Done · Not a problem · Open Ticket (or Edit Ticket) · Need help on them, or the device when it holds none (lineWork). */
  actions: WorkAction[];
  /** The Need help pressed on it that nothing has answered yet (deviceWork.helpAsked): its buttons say so. */
  asked: HelpAsked | null;
  /** Its own source icons (where they are drawn: cardIcons); absent for a line that has none to say. */
  own?: LineSources;
  /** What happened about it on Telegram, in time order — the alert sent, a reminder, an escalation, a button pressed
   *  (ticket 19 of "One inbox"); [] when nothing was told. */
  story: { note: string; at: string }[];
  /** When its fault began (fmEngine.faultBegan, ISO); null for a live state with no fault. */
  openedAt: string | null;
  /** Who last moved its fault, when, and its stage (faultNotes.faultMove): the card's state and the who line; absent
   *  or null: nobody yet. */
  move?: FaultMove | null;
  /** Its own state words (a device's "Unavailable", a task's "Overdue"): its header's on a card of several. */
  state?: RecordStatus[];
  /** Its alert's name ("#91-P1", fmEngine.alertLabel): the chip of the strip. */
  alertLabel?: string;
  /** `openedAt` is only as far back as the villa keeps. */
  openedBefore?: true;
  /** The alert number of its fault ("#91"), whose VESTA card the open issue shows; absent without one. */
  alertNumber?: number;
  /** When the VESTA Agent closes it if it stays as it is now — "Locked since 14:38 · closes at about 14:49 if it stays
   *  locked" (closingText); null when it is not waiting to close. */
  closing: string | null;
  /** VESTA's message of its alert, joined to it once (messagesModel issueAsTold): its words drawn in the line, the
   *  line named by the message's title. Absent on a line VESTA holds no message for, and before the join. */
  told?: Announcement;
}

/** `{ alertNumber }` when there is one, else nothing (an optional field stays absent). */
const alertNumberIn = (n: number | undefined) => (n !== undefined ? { alertNumber: n } : {});

export interface CardView {
  key: string;
  /** "watched": a cleared fault the VESTA Agent still watches (fm/faultConfirm) — in the Watch section, never counted,
   *  its frame marked `fault-watched`; "closed": one over, in the Closed section; absent on every open issue. */
  look?: "watched" | "closed";
  /** When a closed card closed (ISO): its place among what is closed. */
  closedAt?: string;
  /** A watched card's two halves (fm/faultConfirm.confirmParts): its compact row says "Done on 25/10/2026 14:10 (JM)" in its text and
   *  "Closes 15:06" in its pill. */
  watched?: { did: string; when: string; tip: string };
  title: string;
  room?: string;
  /** What a tap on the card opens; undefined: the card is the problem itself (no device). */
  entityId?: string;
  /** The icons before its name: where each of its problems comes from (cardSources). */
  lead: LineSources | null;
  /** "Next check: 02:00", and its moment ("20/10/2026 02:00") (faultTiming.checkPill); `when`: the pill's words beside
   *  its refresh icon ("02:00", "Closes 02:00"); `tip`: what hovering the pill says. null: nothing checks it again at a time. */
  nextCheck: { text: string; at: string | null; when: string; tip: string } | null;
  lines: CardLine[];
  /** Its state, as pills (cardStatuses); absent on a card with none of its own (the Watch list's). */
  status?: RecordStatus[];
  /** How it stands (cardTone): its strip's colour when nothing is said, its place in Open issues. */
  tone?: CardTone;
}

/** ⚠️ EVERY CARD SAYS WHEN, AND A PROBLEM HAS ONE TIME (owner, 2026-11-01: an issue's row said 01:07, its escalation, its
 *  ticket said 00:19, the opening, of the same alert: "it shall be the same time"): when its lead problem began
 *  (fmEngine.faultBegan), on every screen. What was told of it since is its Status. A new alert had no time before this (2026-10-29); every
 *  line has a moment (attention openedAt), a live state too; null only for a device gone longer than the villa keeps.
 *  Pure. */
export function rowTime(card: Pick<CardView, "lines">): string | null {
  return leadLine(card)?.openedAt ?? null;
}

/** The time pill of a card: its moment (rowTime), "Before" one past what the villa keeps, and never an empty pill. Pure. */
export function rowWhen(card: Pick<CardView, "lines">): string {
  const at = rowTime(card);
  if (!at) return TIME_UNKNOWN;
  return leadLine(card)?.openedBefore ? `Before ${momentText(at)}` : momentText(at);
}

/** A card's time pill when nothing says when its problem began. */
export const TIME_UNKNOWN = "Time unknown";

/** The line a card's row in the Inbox names: its alert's (the first line VESTA holds a message for: issueAsTold puts
 *  the other problems first in the opened card), else its first. ⚠️ AN ALERT LEADS ITS ROW (owner, 2026-10-30), in
 *  the words its opened card says it. Undefined for a card with no line. Pure. */
export function leadLine(card: Pick<CardView, "lines">): CardLine | undefined {
  return card.lines.find((l) => l.told) ?? card.lines[0];
}

/** What a card holding an alert says before each of its other problems. */
export const ALSO = "Also: ";

/** ⚠️ THE OTHER PROBLEM READ AS THE ALERT'S HISTORY (owner, 2026-10-30: the onsen pump's night-check line, drawn
 *  under #96's Status lines, "feels like it belongs to the history section"): on a card showing VESTA's message of an
 *  alert (`hasMessage`), every other problem comes first, as one "Also: …" line under the card's name, then the alert
 *  (its icons: cardIcons). The card keeps its height; the row of the list still leads with the alert (lines[0] of
 *  cockpitCard). A card with no alert message, or nothing else, is drawn as it is. Pure. */
export function othersFirst(card: CardView, hasMessage: (line: CardLine) => boolean): CardView {
  const alerts = card.lines.filter(hasMessage), others = card.lines.filter((l) => !hasMessage(l));
  if (alerts.length === 0 || others.length === 0) return card;
  // ⚠️ A PROBLEM AN ALERT TELLS ALREADY IS NO "ALSO" (owner, 2026-11-01: the night check's "… is missing from the villa's
  // system" under #103's same words): its line goes, its icon and its records stay on the alert that tells it
  const tells = (alert: CardLine, other: CardLine) => !!other.text && saysWord(alert.told?.text ?? "", other.text);
  return { ...card, lines: [
    ...others.filter((l) => l.text && !alerts.some((a) => tells(a, l))).map((l) => ({ ...l, text: ALSO + l.text })),
    ...alerts.map((a) => others.filter((l) => tells(a, l)).reduce((line, l) => ({ ...line, own: mergedSources(line.own, l.own),
      ...lineWork([...line.records, ...l.records], card.entityId) }), a)),
  ] };
}

/** Words as compared: their case and closing stop aside. */
const norm = (s: string) => s.trim().replace(/\.$/, "").toLowerCase();

/** Two lines' icons on one line, each source once. */
function mergedSources(a: LineSources | undefined, b: LineSources | undefined): LineSources | undefined {
  if (!a || !b) return a ?? b;
  const fresh = b.sources.flatMap((s, i) => (a.sources.includes(s) ? [] : [{ s, sev: b.severities[i] ?? b.severities[0] }]));
  return { sources: [...a.sources, ...fresh.map((f) => f.s)], severities: [...a.severities, ...fresh.map((f) => f.sev)] };
}

/** The card of `group`, as drawn. `cadence`: the VESTA Agent's own timing (null: it did not say). */
export function cockpitCard(group: AttentionGroup, cadence: AgentCadence | null, now: Date = new Date()): CardView {
  const line = (item: AttentionItem): CardLine => ({
    key: item.id,
    ...lineWork(itemRecords(item), group.entityId),
    text: attentionLineIn(group, item),
    own: lineSources(item),
    story: item.story ?? item.fault?.story ?? [],
    // the fault's moment first: what is told of a device's problem counts from it, not from its state
    openedAt: item.fault?.openedAt ?? item.openedAt ?? null,
    move: item.move ?? item.fault?.move,
    state: itemState(item),
    ...((item.alertLabel ?? item.fault?.alertLabel) ? { alertLabel: item.alertLabel ?? item.fault?.alertLabel } : {}),
    ...(!item.fault && item.openedBefore ? { openedBefore: true as const } : {}),
    ...alertNumberIn(item.alertNumber ?? item.fault?.alertNumber),
    closing: closingText(item.closing ?? item.fault?.closing, now),
  });
  const lead = cardSources(group.items), lines = group.items.map(line);
  return {
    key: group.key, title: group.title, room: group.room, entityId: group.entityId,
    lead,
    nextCheck: checkPill(group.items, cadence, now),
    lines,
    status: cardStatuses(group.items),
    tone: cardTone(lead, lines),
  };
}

/** ⚠️ A CLEARED FAULT VESTA STILL WATCHES IS NOT AN OPEN ISSUE (owner, 2026-10-23: never counted as a problem; its own
 *  Watch section since 2026-10-28). Its card, one per fault: titled by its device and its room as an open issue's is,
 *  its fault's title as its line and "Done on 25/10/2026 14:10 (JM)" under it, "Closes 15:06" in its pill — no buttons
 *  (it is cleared). Only the faults whose device `may` be shown: the
 *  profile's own predicate (VillaAttention.shows, hidden devices out), passed by config/cockpitIssues, the one caller;
 *  `confirming` from fm/faultConfirm.confirmingFaults. */
export function confirmingCards(confirming: readonly ConfirmingFault[], opts: CardsOpts): CardView[] {
  return oneCardPerDevice(confirming.flatMap((c): CardView[] => {
    const said = confirmParts(c);
    // ⚠️ THE SAME CARD AS AN OPEN ISSUE'S (owner, 2026-10-23: "the same piece of code … the same style and the same
    // card layout; only the height of the card changes, and no Open Ticket / Close buttons"): its pill is the open
    // issues' pill, saying VESTA closes it then ("Closes 02:00", then "Closes within 5 min", owner 2026-10-31), who
    // cleared it the line under its fault
    // ...one about to be watched has no pill until VESTA says when (faultConfirm.afterClose, architecture review round 16)
    return clearedCard(c.ticket, said.did, opts, { key: `watched:${c.ticket.id}`, look: "watched", watched: said,
      nextCheck: c.awaiting ? null : { text: said.tip, at: null, when: said.when, tip: said.tip } });
  }));
}

/** ⚠️ ONE CARD PER DEVICE ON WATCH, AS IN OPEN ISSUES (owner, 2026-11-02: two LED Strip cards on Watch, "the same issue
 *  being reported in 2 distinct cards"; rules: One line per problem): Open issues groups a device's problems in one card
 *  (attention.groupAttention), Watch drew one card per watched fault. A device's watched faults are now the lines of
 *  its one card, which stays on Watch until the last of them closes: its pill the latest close (`watched` comes soonest
 *  first, confirmingFaults). A fault with no device keeps its own card. Pure. */
function oneCardPerDevice(cards: readonly CardView[]): CardView[] {
  const byKey = new Map<string, CardView>();
  for (const c of cards) {
    const key = c.entityId ? `${c.look}:device:${c.entityId}` : c.key;
    const had = byKey.get(key);
    byKey.set(key, had ? { ...had, lines: [...had.lines, ...c.lines], nextCheck: c.nextCheck ?? had.nextCheck, watched: c.watched } : { ...c, key });
  }
  return [...byKey.values()];
}

/** Every closed fault as its card, for the Closed section (owner, 2026-11-01): a watched card's, with nothing left to
 *  check, the last closed first (faultConfirm.closedFaults).
 *  ⚠️ TAKEN BACK WHEN NOTHING CHECKS IT AGAIN (owner, 2026-11-04: "just add this button for the faults that have been
 *  closed with the Not a problem while it lasts status"; architecture review 23: one rule with Tickets › Closed,
 *  faultConfirm.closedTold): such a close had no way back. ⚠️ TOLD AS TICKETS › CLOSED TELLS IT (review 23): its strip
 *  and who line, who closed it, how and when (faultNotes.faultMove), never words of its own. */
export function closedCards(fmData: FmData, cadence: AgentCadence | null, now: Date, opts: CardsOpts): CardView[] {
  return closedFaults(fmData, cadence, now.getTime()).flatMap((c) => clearedCard(c.ticket, "", opts,
    { key: `closed:${c.ticket.id}`, look: "closed", nextCheck: null,
      ...(Number.isNaN(c.closedAt) ? {} : { closedAt: new Date(c.closedAt).toISOString() }) }));
}

interface CardsOpts {
  devices: Pick<VillaDevices, "deviceOf">;
  entities: Record<string, HassEntity>;
  entityMap: Parameters<typeof labelOf>[1];
  resolvedRooms: Record<string, string>;
  may: (entityId: string) => boolean;
}

/** The card of a fault no longer open: titled by its device and its room as an open issue's is, its fault's title as
 *  its line and how it closed (`did`) under it; a Reopen only under Closed, on a "Not a problem while it lasts".
 *  None when the profile may not see its device. */
function clearedCard(t: FmTicket, did: string, opts: CardsOpts, own: Pick<CardView, "key" | "look" | "nextCheck" | "watched" | "closedAt">): CardView[] {
  const { devices, entities, entityMap, resolvedRooms, may } = opts;
  const entityId = recordEntity(t.entityId, (x) => x in entities);
  if (entityId && !may(entityId)) return [];
  // its device, title and room as an open issue's card has them (attention cardDevice / cardHead)
  const device = entityId ? cardDevice(entityId, t.room, { devices, entityMap, entities, resolvedRooms }) : undefined;
  const title = faultName(t);
  return [{
    ...own,
    ...cardHead(device, title, t.room),
    entityId: device?.key,
    lead: null,
    lines: [{ key: `fault:${t.id}`, records: [], actions: own.look === "closed" ? closedActions(workRecord(t), closedTold(t).reopen) : [], asked: null, text: device && title !== device.label ? title : "", story: [], openedAt: faultBegan(t),
      closing: own.look === "closed" ? null : did, state: [],
      ...(own.look === "closed" ? { move: faultMove(t) } : {}),
      ...alertNumberIn(alertNumberOf(t)),
      ...(faultAlertLabel(t) ? { alertLabel: faultAlertLabel(t) } : {}) }],
    // a watched one is being handled (VESTA closes it), a closed one is over: both quiet but the watch's green
    tone: own.look === "watched" ? "handled" : "lost",
  }];
}
