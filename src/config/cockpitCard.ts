// src/config/cockpitCard.ts
// ONE COCKPIT CARD, AS IT IS DRAWN (architecture review scan 1, 2026-10-19): its title and room, the icons before its
// name, its "Next check" and the date and time behind it, its buttons, and each problem's line — words, icons, what
// last happened on Telegram, its own Close. Pure; IssueCard draws exactly this, a check reads it by value.
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
import { lineActions, overviewActions, type WorkAction, type WorkRecord } from "@/fm/deviceWork";
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

/** What a card's buttons do (owner, 2026-10-14) — on its records only (its own fault lines and those folded onto a
 *  live state's line by mergeFaults): fm/deviceWork.overviewActions' answer, in the order drawn. Empty when it holds
 *  none, so a card that is only what Home Assistant reports has no button. */
function cardActions(group: AttentionGroup): WorkAction[] {
  return overviewActions(cardRecords(group), problemLines(group), group.entityId);
}

/** One line's own Close (deviceWork.lineActions): on a card holding several problems, each closes alone. */
function itemActions(group: AttentionGroup, item: AttentionItem): WorkAction[] {
  return lineActions(itemRecords(item), problemLines(group));
}

/** How many of a card's lines carry a record a person can close. */
function problemLines(group: AttentionGroup): number {
  return group.items.filter((i) => itemRecords(i).length > 0).length;
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
 *  open fault's line is empty — its title is the row's, its Close the line's). Every row shows its problems this way,
 *  one or several. */
function attentionLineIn(group: AttentionGroup, item: AttentionItem): string {
  return group.key.startsWith("device:") ? attentionLine(item) : faultStatus(item) ?? item.detail ?? "";
}

/** What a fault's line must say of its status: nothing while it is open, its stage's word (fmEngine.STAGE_WORDS:
 *  "In progress") once someone took it.
 *  ⚠️ "OPEN FAULT:" BEFORE EVERY FAULT SAID NOTHING (owner, 2026-10-14: "this seems providing no value"): the row's
 *  icon says it is a fault and its Close that it is open — the words only pushed the text to a second line.
 *  undefined for anything that is not a fault. */
function faultStatus(item: AttentionItem): string | undefined {
  if (item.kind !== "fault") return undefined;
  return item.stage === "ticket" ? STAGE_WORDS.ticket.word : "";
}

/** The icons a problem's line shows inside its row: its own sources only where the row's icons do not say them already
 *  — the row's are its first line's (IssueCard draws them beside the device's name).
 *  ⚠️ ONE ICON PER MEANING (owner, 2026-10-13: "the icon is redundant"): every line repeated its row's icon — a red "!"
 *  beside "House & Pool Relay" and again before "Open fault: …". A row mixing kinds (a lock "Unlocked" with a fault on
 *  its battery) still marks the line whose kind is not the row's. */
function lineIcon(group: AttentionGroup, item: AttentionItem): LineSources | null {
  const own = lineSources(item), row = lineSources(group.items[0] ?? item);
  return item === group.items[0] || JSON.stringify(own) === JSON.stringify(row) ? null : own;
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
  /** Its source icons, only where the card's own do not say them already; null: none. */
  icons: LineSources | null;
  /** What happened about it on Telegram, in time order — the alert sent, a reminder, an escalation, a button pressed
   *  (ticket 19 of "One inbox"); [] when nothing was told. */
  story: { note: string; at: string }[];
  /** The alert number of its fault ("#91"), whose VESTA card the open issue shows; absent without one. */
  alertNumber?: number;
  /** When the VESTA Agent closes it if it stays as it is now — "Locked since 14:38 · closes at about 14:49 if it stays
   *  locked" (closingText); null when it is not waiting to close. */
  closing: string | null;
  /** Its own Close, on a card holding several problems; [] otherwise. */
  actions: WorkAction[];
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
  /** The icons before its name: where its first problem comes from. */
  lead: LineSources | null;
  /** "Next check: 02:00", and its moment ("20/10/2026 02:00") — null when it has none (live, by hand). `when`: the
   *  pill's words beside its refresh icon ("02:00"); `tip`: what hovering the pill says (the text, then the moment). */
  nextCheck: { text: string; at: string | null; when: string; tip: string } | null;
  /** Open Ticket / Edit Ticket / Close / Close all — on its records; [] for a card only the villa's system reports. */
  actions: WorkAction[];
  lines: CardLine[];
}

function nextCheckView(group: AttentionGroup, cadence: AgentCadence | null, now: Date, at: Date | null): CardView["nextCheck"] {
  const text = nextCheck(group.items, cadence, now);
  const moment = at ? momentText(at) : null;
  return { text, at: moment, when: nextCheckWhen(group.items, cadence, now), tip: moment ? `${text} (${moment})` : text };
}

/** The card of `group`, as drawn. `cadence`: the VESTA Agent's own timing (null: it did not say). */
export function cockpitCard(group: AttentionGroup, cadence: AgentCadence | null, now: Date = new Date()): CardView {
  const at = nextCheckAt(group.items, cadence, now);
  const line = (item: AttentionItem): CardLine => ({
    key: item.id,
    text: attentionLineIn(group, item),
    icons: lineIcon(group, item),
    story: item.story ?? item.fault?.story ?? [],
    ...alertNumberIn(item.alertNumber ?? item.fault?.alertNumber),
    closing: closingText(item.closing ?? item.fault?.closing, now),
    actions: itemActions(group, item),
  });
  return {
    key: group.key, title: group.title, room: group.room, entityId: group.entityId,
    lead: group.items[0] ? lineSources(group.items[0]) : null,
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
      lines: [{ key: `fault:${t.id}`, text: device ? title : "", icons: null, story: [], closing: said.did, actions: [],
        ...alertNumberIn(alertNumberOf(t)) }],
    }];
  });
}
