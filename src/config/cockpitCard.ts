// src/config/cockpitCard.ts
// ONE COCKPIT CARD, AS IT IS DRAWN (architecture review scan 1, 2026-10-19): its title and room, the icons before its
// name, its "Next check" and the date and time behind it, its buttons, and each problem's line — words, icons, what
// last happened on Telegram. Pure; IssueCard draws exactly this, a check reads it by value.
//
// ⚠️ FIVE CALLS, ONE CARD: the page asked attention for a line's words (twice: once for its hover text), its icons,
// its buttons and the card's, and faultTiming for its next check, and worked out a line's latest Telegram note itself
// (`item.latest ?? item.fault?.latest`) — each reading the shape the grouping leaves behind (`fault`, `twins`). The
// "one line per problem" bugs of the week (10-13 a repeated icon, 10-17 "(6 times)", 10-18 "UNLOCKED — … UNLOCKED")
// were each fixed in one of those calls; the page now knows none of them.
//
// ⚠️ AND THE FIVE CALLS ARE THIS FILE'S OWN (architecture review, 2026-10-19): attention still exported them, and the
// checks read them one by one — a line's words could be right in a check and wrong on the card. attention groups the
// problems; how a card SAYS them lives here only, and a check reads what cockpitCard returns.

import type { AgentCadence } from "@/agent/agentApi";
import { nextCheck, nextCheckAt, nextCheckWhen } from "@/fm/faultTiming";
import { overviewActions, type WorkAction, type WorkRecord } from "@/fm/deviceWork";
import { STAGE_WORDS } from "@/fm/fmEngine";
import type { IssueSource } from "@/fm/issueSource";
import { clockTime, dayMonth, momentText } from "@/utils/dateText";
import { sinceText } from "./presence";
import { confirmParts, type ConfirmingFault } from "@/fm/faultConfirm";
import { alertNumberOf, faultTitle } from "@/fm/fmEngine";
import type { HassEntity } from "@/types/ha.types";
import { labelOf } from "./EntityMap";
import { recordEntity, type VillaDevices } from "./deviceGroups";
import { attentionSeverity, cardDevice, cardHead, type AttentionGroup, type AttentionItem, type AttentionSeverity } from "./attention";

/** What a card's buttons do (owner, 2026-10-14; one set on every card, 2026-10-30) — on its records (its own fault
 *  lines and those folded onto a live state's line by mergeFaults), or its device when it holds none:
 *  fm/deviceWork.overviewActions' answer, in the order drawn. Empty for a card with neither. */
function cardActions(group: AttentionGroup): WorkAction[] {
  return overviewActions(cardRecords(group), group.entityId);
}

/** The records of one line — its fault, or the fault folded onto its live state, with their copies. */
function itemRecords(i: AttentionItem): WorkRecord[] {
  const f = i.kind === "fault" ? i : i.fault;
  return f ? [f.ticketId, ...(f.twins ?? [])].flatMap((id) => (id
    ? [{ id, stage: f.stage ?? "fault" }] : [])) : [];
}

/** The records on a card — its faults and tickets, each with its stage. */
function cardRecords(group: AttentionGroup): WorkRecord[] {
  return group.items.flatMap(itemRecords);
}

/** A problem's line inside ITS row: under a device, what attentionLine says ("Unlocked", "Entrance door unlocked");
 *  in a row that is the problem itself (no device), only a status the row does not show already ("In progress"; an
 *  open fault's line is empty — its title is the row's). Every row shows its problems this way,
 *  one or several. */
function attentionLineIn(group: AttentionGroup, item: AttentionItem): string {
  return group.key.startsWith("device:") ? attentionLine(item) : faultStatus(item) ?? item.detail ?? "";
}

/** What a fault's line must say of its status: nothing while it is open, its stage's word (fmEngine.STAGE_WORDS:
 *  "In progress") once someone took it.
 *  ⚠️ "OPEN FAULT:" BEFORE EVERY FAULT SAID NOTHING (owner, 2026-10-14: "this seems providing no value"): the row's
 *  icon says it is a fault and its Done that it is open — the words only pushed the text to a second line.
 *  undefined for anything that is not a fault. */
function faultStatus(item: AttentionItem): string | undefined {
  if (item.kind !== "fault") return undefined;
  return item.stage === "ticket" ? STAGE_WORDS.ticket.word : "";
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
 *  `column`: the card keeps its icon column (the lines' text lines up, the icons stay inside the card) whenever any
 *  icon is drawn. The list's row, which draws no line, draws `lead` whole.
 *  ⚠️ ONE PLACE FOR THE ICONS (owner, 2026-10-30, review round 4: three icon fixes in one afternoon — "a card's icons
 *  say every problem", "i see twice the same icons", "the icons appear outside the cards"): a line's icon was decided
 *  before the lines were put in their order, then patched three times (the first line's dropped for the name, given
 *  back to the alert drawn second, taken off the name, the emptied column padded). ⚠️ ONE ICON PER MEANING (owner,
 *  2026-10-13: "the icon is redundant"): a line never repeats an icon the name shows. Pure. */
export function cardIcons(card: Pick<CardView, "lead" | "lines">): {
  head: LineSources | null; lines: (LineSources | null)[]; column: boolean;
} {
  const owns = card.lines.map((l) => l.own ?? null);
  const kinds = new Set(owns.filter((o): o is LineSources => o !== null).map((o) => o.sources.join("+")));
  if (kinds.size <= 1) return { head: card.lead, lines: owns.map(() => null), column: card.lead !== null };
  return { head: null, lines: owns, column: true };
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

/** Does `title` already say `word` ("Laundry Room door unlocked" says "Unlocked"), as a whole word, whatever its case? */
function saysWord(title: string, word: string): boolean {
  const w = word.trim().toLowerCase();
  if (!w) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u")
    .test(title.toLowerCase());
}

/** One problem's line inside a device's row. A state needs no more than its
 *  word ("Unlocked", "Unavailable"); a fault or a schedule names itself, since
 *  its title is what is wrong, not the device ("Entrance door unlocked"; "In
 *  progress: …" once someone took it, faultStatus). */
function attentionLine(item: AttentionItem): string {
  const titled = (i: AttentionItem) => { const st = faultStatus(i); return `${st ? `${st}: ${i.title}` : i.title}${timesSaid(i)}`; };
  if (item.fault) {
    const st = faultStatus(item.fault);
    const fault = `${st ? `${st.toLowerCase()}: ` : ""}${item.fault.title}${timesSaid(item.fault)}`;
    // ⚠️ "UNAVAILABLE — … OFFLINE FOR 9 H" SAID IT TWICE (owner, 2026-10-14): the fault on an unavailable line says the
    // device is offline already. ⚠️ SO DID "UNLOCKED — #41 · LAUNDRY ROOM DOOR UNLOCKED" (owner, 2026-10-18): a state
    // word the fault's title already says is not said before it. A word the fault does not say stays: "Not in Home
    // Assistant", a live reading ("92 %").
    const word = item.detail ?? "";
    const said = (item.kind === "unavailable" && word === "Unavailable") || saysWord(item.fault.title, word);
    return said ? fault.charAt(0).toUpperCase() + fault.slice(1) : `${word}, ${fault}`;
  }
  if (item.kind === "fault") return titled(item);
  return item.kind === "schedule" ? `${item.detail}: ${item.title}` : item.detail ?? "";
}

/** ⚠️ A FAULT WAITING TO CLOSE SAYS SO (owner, 2026-10-21): a door locked at 14:38:50 was still a fault at 14:45 under
 *  "Next check: within 5 min" — the VESTA Agent closes it once it has stayed right for its clear wait, and nothing said
 *  it. "Locked since 14:38 · closes at about 14:49 if it stays locked"; its moment past: "at the next check". */
function closingText(c: AttentionItem["closing"], now: Date): string | null {
  if (!c) return null;
  const at = Date.parse(c.at);
  const when = at > now.getTime() ? `closes at about ${clockTime(at)}` : "closes at the next check";
  if (!c.word) return `Back to normal · ${when} if it stays so`;
  const said = sinceText(c.since ?? null, clockTime, dayMonth);
  const since = said ? ` since ${said}` : "";
  return `${c.word}${since} · ${when} if it stays ${c.word.toLowerCase()}`;
}

/** One problem's line inside the card. */
export interface CardLine {
  key: string;
  /** Its words ("Unlocked", "In progress: Back door stiff"); whole on hover. */
  text: string;
  /** Its own source icons (where they are drawn: cardIcons); absent for a line that has none to say. */
  own?: LineSources;
  /** What happened about it on Telegram, in time order — the alert sent, a reminder, an escalation, a button pressed
   *  (ticket 19 of "One inbox"); [] when nothing was told. */
  story: { note: string; at: string }[];
  /** When its fault was opened (ISO); null for a live state with no fault. */
  openedAt: string | null;
  /** The alert number of its fault ("#91"), whose VESTA card the open issue shows; absent without one. */
  alertNumber?: number;
  /** When the VESTA Agent closes it if it stays as it is now — "Locked since 14:38 · closes at about 14:49 if it stays
   *  locked" (closingText); null when it is not waiting to close. */
  closing: string | null;
}

/** `{ alertNumber }` when there is one, else nothing (an optional field stays absent). */
const alertNumberIn = (n: number | undefined) => (n !== undefined ? { alertNumber: n } : {});

export interface CardView {
  key: string;
  /** "watched": a fault a person closed that the VESTA Agent reads again (fm/faultConfirm) — listed LAST among the open
   *  issues, never counted, its frame marked `fault-watched`; absent on every open issue. */
  look?: "watched";
  /** A watched card's two halves (fm/faultConfirm.confirmParts): its compact row says "Done on 25/10/2026 14:10 (JM)" in its text and
   *  "VESTA confirms by 15:06" in its pill. */
  watched?: { did: string; when: string; tip: string };
  title: string;
  room?: string;
  /** What a tap on the card opens; undefined: the card is the problem itself (no device). */
  entityId?: string;
  /** The icons before its name: where each of its problems comes from (cardSources). */
  lead: LineSources | null;
  /** "Next check: 02:00", and its moment ("20/10/2026 02:00") — null when it has none (live, by hand). `when`: the
   *  pill's words beside its refresh icon ("02:00"); `tip`: what hovering the pill says (the text, then the moment). */
  nextCheck: { text: string; at: string | null; when: string; tip: string } | null;
  /** Done · Need help · Open Ticket (or Edit Ticket) — on its records, or its device when it holds none (deviceWork). */
  actions: WorkAction[];
  lines: CardLine[];
}

function nextCheckView(group: AttentionGroup, cadence: AgentCadence | null, now: Date, at: Date | null): CardView["nextCheck"] {
  const text = nextCheck(group.items, cadence, now);
  const moment = at ? momentText(at) : null;
  return { text, at: moment, when: nextCheckWhen(group.items, cadence, now), tip: moment ? `${text} (${moment})` : text };
}

/** ⚠️ EVERY ROW SAYS WHEN (owner, 2026-10-29: "why I don't see the time in the VESTA card, as any other notification?"):
 *  an issue's row in Messages shows when its first problem was last told of (its story's last step), else when it was
 *  opened: a new alert has no step yet, and its row showed no time at all. Null for a live state with neither. Pure. */
export function rowTime(card: Pick<CardView, "lines">): string | null {
  const first = card.lines[0];
  if (!first) return null;
  return first.story.length ? first.story[first.story.length - 1].at : first.openedAt;
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
  return { ...card, lines: [
    ...others.map((l) => ({ ...l, text: ALSO + l.text })),
    ...alerts,
  ] };
}

/** The card of `group`, as drawn. `cadence`: the VESTA Agent's own timing (null: it did not say). */
export function cockpitCard(group: AttentionGroup, cadence: AgentCadence | null, now: Date = new Date()): CardView {
  const at = nextCheckAt(group.items, cadence, now);
  const line = (item: AttentionItem): CardLine => ({
    key: item.id,
    text: attentionLineIn(group, item),
    own: lineSources(item),
    story: item.story ?? item.fault?.story ?? [],
    openedAt: item.openedAt ?? item.fault?.openedAt ?? null,
    ...alertNumberIn(item.alertNumber ?? item.fault?.alertNumber),
    closing: closingText(item.closing ?? item.fault?.closing, now),
  });
  return {
    key: group.key, title: group.title, room: group.room, entityId: group.entityId,
    lead: cardSources(group.items),
    nextCheck: nextCheckView(group, cadence, now, at),
    actions: cardActions(group),
    lines: group.items.map(line),
  };
}

/** ⚠️ A FAULT BEING CONFIRMED IS NOT AN OPEN ISSUE (owner, 2026-10-23: kept in the Open issues list, LAST, and never
 *  counted as a problem). Its card, one per fault: titled by its device and its
 *  room as an open issue's is, its fault's title as its line and "Done on 25/10/2026 14:10 (JM) · VESTA confirms by 15:06" under it — no
 *  buttons (it is closed), no next-check pill (its line says when). Only the faults whose device `may` be shown: the
 *  profile's own predicate (VillaAttention.shows, hidden devices out), passed by config/cockpitIssues, the one caller;
 *  `confirming` from fm/faultConfirm.confirmingFaults. */
export function confirmingCards(confirming: readonly ConfirmingFault[], opts: {
  devices: Pick<VillaDevices, "deviceOf">;
  entities: Record<string, HassEntity>;
  entityMap: Parameters<typeof labelOf>[1];
  resolvedRooms: Record<string, string>;
  may: (entityId: string) => boolean;
}): CardView[] {
  const { devices, entities, entityMap, resolvedRooms, may } = opts;
  return confirming.flatMap((c): CardView[] => {
    const t = c.ticket;
    const entityId = recordEntity(t.entityId, (x) => x in entities);
    if (entityId && !may(entityId)) return [];
    // its device, title and room as an open issue's card has them (attention cardDevice / cardHead)
    const device = entityId ? cardDevice(entityId, t.room, { devices, entityMap, entities, resolvedRooms }) : undefined;
    const title = faultTitle(t);
    const said = confirmParts(c);
    return [{
      key: `watched:${t.id}`, look: "watched", watched: said,
      ...cardHead(device, title, t.room),
      entityId: device?.key,
      // ⚠️ THE SAME CARD AS AN OPEN ISSUE'S (owner, 2026-10-23: "the same piece of code … the same style and the same
      // card layout; only the height of the card changes, and no Open Ticket / Close buttons"): its pill is the open
      // issues' next-check pill (its time, then "within 5 min"), who closed it the line under its fault
      lead: null, nextCheck: { text: said.tip, at: null, when: said.when, tip: said.tip }, actions: [],
      lines: [{ key: `fault:${t.id}`, text: device ? title : "", story: [], openedAt: t.openedAt ?? null,
        closing: said.did,
        ...alertNumberIn(alertNumberOf(t)) }],
    }];
  });
}
