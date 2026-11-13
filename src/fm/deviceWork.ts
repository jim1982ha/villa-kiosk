// src/fm/deviceWork.ts
// A DEVICE'S OPEN WORK — its faults and its tickets — as every screen and count shows it (architecture review,
// 2026-10-16). ONE card per device: the Overview's Live issues (config/attention.groupAttention, which adds the
// device's live state and late maintenance to the same card), the Tickets tab's tickets in progress, and the figures
// that count them (openCounts: Schedule's, the Recap's readiness). ONE table of what a card's buttons do, on which
// records, and what each asks before it closes something.
//
// ⚠️ IT WAS BUILT TWICE (until 2.496.393): the Overview grouped on `device:${key}`, the Tickets tab on the bare key, and
// their buttons were decided in two places — a pure rule on the Overview, closures inside the Tickets tab's JSX — with
// the close-confirm-error steps written out in each. Each stays its own record underneath, so the VESTA Agent can
// still clear one problem by itself (its record closes; the ticket stays while another is in progress).
// Pure — tests/oracles/live_issues.mjs drives it by value.

import type { FmTicket, FmTicketStatus } from "./fmTypes";
import { helpIsLatest, isTicketOpen, stageOf, standingHelp, type FmStage, type HelpAsked } from "./fmEngine";

// ── One card per device ──────────────────────────────────────────────────────

/** The card a thing belongs to: its DEVICE (deviceGroups.deviceOf — the owner's device groups, then the device
 *  registry), else the thing alone (a fault on no device, a whole-villa task). The Overview and the Tickets tab both
 *  key on this, so one device is one card in both. */
export function deviceWorkKey(device: string | undefined, ownId: string): string {
  return device ? `device:${device}` : `item:${ownId}`;
}

/** A record's card: its entity's device, else the record alone — the same key its Overview line gets (its line's id
 *  is `fault:<record id>`, config/attention.attentionOf). `cardOf`: the villa's one answer to "which device's card
 *  does this record's entity field name" (VillaDevices.cardOfRecord — a list of several included; undefined for a
 *  device hidden in the villa's system: the record alone, as the Open issues file it). */
export function recordWorkKey(t: Pick<FmTicket, "id" | "entityId">, cardOf: CardOf): string {
  return deviceWorkKey(t.entityId ? cardOf(t.entityId) : undefined, `fault:${t.id}`);
}

/** The device a record's card is filed under, undefined for none (VillaDevices.cardOfRecord). */
type CardOf = (field: string) => string | undefined;

/** `things` grouped by `keyOf`, in the order each key first appears; every thing comes back exactly once. */
export function groupByDevice<T>(things: readonly T[], keyOf: (t: T) => string): { key: string; items: T[] }[] {
  const out = new Map<string, T[]>();
  for (const t of things) {
    const key = keyOf(t);
    const list = out.get(key);
    if (list) list.push(t); else out.set(key, [t]);
  }
  return [...out].map(([key, items]) => ({ key, items }));
}

/** One device's records, as one card. */
export interface DeviceWork {
  /** recordWorkKey — the same as the device's Overview card's. */
  key: string;
  records: FmTicket[];
}

/** `records` grouped by device, in the order each device first appears. */
function workByDevice(records: readonly FmTicket[], cardOf: CardOf): DeviceWork[] {
  return groupByDevice(records, (t) => recordWorkKey(t, cardOf)).map(({ key, items }) => ({ key, records: items }));
}

/** The Tickets tab's cards: the tickets in progress, one per device, the device whose latest was opened last first. */
export function ticketCards(records: readonly FmTicket[], cardOf: CardOf): DeviceWork[] {
  return workByDevice(records.filter((t) => stageOf(t) === "ticket")
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)), cardOf);
}

// ── What a card's buttons do ─────────────────────────────────────────────────

/** Every button a card of open work can carry. An issue card's (the Inbox's): Done · Not a problem · Open Ticket (or Edit
 *  Ticket) · Need help, `doneNew` / `helpNew` on a card with no record yet (only what the villa's system reports: a fault for its
 *  device is raised with the press). A Tickets card's: Close · No action needed · Need help (`ticketDone`: the resolve form, work
 *  done; `closeTicket`: that ticket's records closed with nothing done and no cost, fmCommands' closeTickets). */
export type WorkActionKind = "done" | "needHelp" | "notAProblem" | "doneNew" | "helpNew" | "openTicket" | "raiseTicket"
  | "editTicket" | "ticketDone" | "closeTicket" | "reopen";

/** What a button does once pressed (carried out as fm/workPress.pressOutcome says): record a stage change (FaultStageModal, to `to`), open the record's form, open
 *  the ticket form pointed at a device, ask for help on the records (a "help" step: the VESTA Agent asks the owner to
 *  act), raise a fault for the device and close it or ask for help on it in the same write (`then`), or close the
 *  records (after its question, when it has one). */
type WorkStep =
  | { kind: "stage"; to: FmTicketStatus }
  | { kind: "edit" }
  | { kind: "raise" }
  | { kind: "help" }
  | { kind: "raiseThen"; then: "done" | "help" }
  /** The villa's own visit card (VESTA away): the press goes to the villa as its Telegram press does, `option` the
   *  villa's button (messagesModel.villaAlertCards, fm/workPress); the action's one id is the card's key. */
  | { kind: "visit"; option: string }
  /** `work`: the records are resolved as work done (a completion with who did it, in Recent work, as a Done on Telegram
   *  records it: the Agent's resolve_ticket); without, closed with no action (no completion, no cost). `lasting`: closed
   *  with no action as "Not a problem while it lasts" (FmTicketUpdate.lasting). `ask`: the question asked in place of
   *  the buttons before it closes, and its yes; none: it closes as pressed. */
  | { kind: "close"; ask?: { question: string; confirmLabel: string }; work?: true; lasting?: true };

/** `short`: its one word where the card's row is too narrow for every label in full (owner, 2026-11-04, a phone: "use
 *  1 word label and icon in the button"; WorkButtons.WorkLabel, 07-facility.css); none when the label is one word. */
interface WorkActionSpec { label: string; short?: string; step: WorkStep }

/** The words Done and Need help say on every card, the Inbox's and the Tickets tab's alike. */
const DONE = "Done";
export const NEED_HELP = "Need help";
/** ⚠️ WHAT THE OWNER KNOWS BETTER THAN THE CHECKS (owner, 2026-11-02: a pump stopped on purpose, flagged every night):
 *  closed with nothing done, and never raised again while the problem lasts (FmTicketUpdate.lasting); back after it
 *  ended, it is new. ⚠️ A BUTTON OF ITS OWN (owner, 2026-11-04: "instead of showing the button `Not a problem while it
 *  lasts` only after clicking on the `Done` Button, show it directly next to `Done`, `Need Help`"): it was the second
 *  answer to a Done's or a No action needed's question; now it follows Done on every card that offers Done on a
 *  record on the Inbox while none is a ticket (never a ticket's: owner, 2026-11-04; notAProblem), in the order VESTA's own alert offers it on Telegram, its label short ("the button label must be short":
 *  owner, 2026-11-04); pressed, it closes, no question asked (owner, 2026-11-04). */
export const NOT_A_PROBLEM = "Not a problem";
/** A close with nothing done: its button, and how its close is told (faultConfirm.closedTold). */
export const NO_ACTION_NEEDED = "No action needed";
/** The one words of Need help, Not a problem and a ticket's button on a narrow row (WorkActionSpec.short). */
const HELP = "Help", IGNORE = "Ignore", TICKET = "Ticket";

/** ONE wording per action. */
export const WORK_ACTIONS: Record<WorkActionKind, WorkActionSpec> = {
  // ⚠️ DONE · NEED HELP · OPEN TICKET ON EVERY ISSUE CARD (owner, 2026-10-30: "a unique configuration … Done and Close
  // shall do the same thing"): an alert's card had VESTA's Done · Need help, a fault's Open Ticket · Close
  // ⚠️ A DONE IS WORK DONE, WHEREVER IT IS PRESSED (owner, 2026-10-30, review round 4: Done on Telegram filed a
  // completion in Recent work, the same Done on the Cockpit card a "Closed without action" gone after 90 days)
  // ⚠️ NO QUESTION (owner, 2026-11-07: "remove this confirmation message when user click on `Done`"): it asked
  // "Done? VESTA checks it again before it closes." first; it closes as pressed, as Not a problem does
  done: { label: DONE, step: { kind: "close", work: true } },
  needHelp: { label: NEED_HELP, short: HELP, step: { kind: "help" } },
  // ⚠️ NO QUESTION (owner, 2026-11-04: "When I click 'ignore' I don't want to see the confirmation message since it's
  // redundant"): it closes as pressed, as VESTA's own "Not a problem" does on Telegram and the tablet
  notAProblem: { label: NOT_A_PROBLEM, short: IGNORE, step: { kind: "close", lasting: true } },
  doneNew: { label: DONE, step: { kind: "raiseThen", then: "done" } },
  helpNew: { label: NEED_HELP, short: HELP, step: { kind: "raiseThen", then: "help" } },
  openTicket: { label: "Open Ticket", short: TICKET, step: { kind: "stage", to: "in_progress" } },
  // a card with no record yet (only what the villa's system reports): the same words, the ticket form for its device
  raiseTicket: { label: "Open Ticket", short: TICKET, step: { kind: "raise" } },
  editTicket: { label: "Edit Ticket", short: TICKET, step: { kind: "edit" } },
  // the Tickets tab's work done, its form (what was done, cost, photos). ⚠️ SAID "CLOSE" (owner, 2026-11-04: "in the
  // Ticket card, the `Done` shall be renamed to `Close`"): it said Done, as the Inbox's (2026-10-30), until then
  ticketDone: { label: "Close", step: { kind: "stage", to: "resolved" } },
  // what it records in its words (owner, 2026-11-01): "Close" read as the normal end of a ticket, beside Done
  closeTicket: { label: NO_ACTION_NEEDED, short: "Dismiss", step: { kind: "close", ask: { question: "Close this ticket? Nothing was done, no cost is recorded.", confirmLabel: NO_ACTION_NEEDED } } },
  reopen: { label: "Reopen", step: { kind: "stage", to: "open" } },
};

/** A button on a card: what it is, and the records it acts on (never empty) — raiseTicket's: the device. */
export interface WorkAction extends WorkActionSpec { kind: WorkActionKind; ids: string[] }

const action = (kind: WorkActionKind, ids: string[]): WorkAction => ({ kind, ids, ...WORK_ACTIONS[kind] });

/** A record as a card's buttons see it: which one, where it stands, and the Need help on it nothing has answered yet
 *  (fmEngine.standingHelp). */
export interface WorkRecord {
  id: string; stage: FmStage; help?: HelpAsked;
  /** Its card's pill already says that Need help (fmEngine.helpIsLatest): no line above the buttons repeats it. */
  helpInPill?: true;
}

/** ⚠️ NEED HELP IS ASKED ONCE (architecture review round 6, 2026-10-30: the card looked the same after the press, so it
 *  was pressed again and the owner asked twice): a card's Need help acts on the records nobody has asked about yet, and
 *  is not offered once every one of them has been. */
function needHelp(records: readonly WorkRecord[]): WorkAction[] {
  const ids = records.filter((r) => !r.help).map((r) => r.id);
  return ids.length ? [action("needHelp", ids)] : [];
}

/** The Need help a card says above its buttons: the latest standing one among its records whose pill does not already
 *  say it (helpInPill: a fact said once), null with none. */
export function helpAsked(records: readonly WorkRecord[]): HelpAsked | null {
  return records.reduce<HelpAsked | null>((last, r) => (r.help && !r.helpInPill && (!last || Date.parse(r.help.at) >= Date.parse(last.at))
    ? r.help : last), null);
}

/** What a card says of its standing Need help, under its buttons on the Inbox and the Tickets tab alike: "🆘 Need help
 *  asked 17:20 (Owner)" (`stamp`: the app's moment, dateText.momentText). Until the VESTA Agent's own line of the
 *  escalation it sent arrives in the card's story, which then says it (standingHelp). */
export function helpLine(h: HelpAsked, stamp: (at: string) => string): string {
  return `🆘 ${NEED_HELP} asked ${stamp(h.at)}${h.by ? ` (${h.by})` : ""}`;
}

/**
 * The buttons of an issue card (the Inbox's), from the device's open records (its own fault lines and those folded onto
 * a live state's line): Done · Not a problem · Open Ticket · Need help, the same on every card and on VESTA's alert on
 * Telegram (⚠️ ONE ORDER, owner 2026-11-05: "Done · Not a problem · Open Ticket · Need help"). Done closes them ALL, faults and
 * tickets, each read again by the VESTA Agent ("one Done closes everything on the card", owner 2026-10-30, in place of
 * each line's own Close of 2026-10-18); Need help writes a "help" step on each not asked about yet (none left: no
 * Need help); Open Ticket takes on its faults (one ticket for the device), "Edit Ticket" as soon as one is a ticket:
 * ⚠️ A TICKET IS ALREADY OPEN (owner, 2026-11-01: an "In progress" card offered Open Ticket because a second fault had
 * joined it; Done closes that one with the rest). A card holding no record — only what the villa's
 * system reports — has the same three for its `device`: Done and Need help raise its fault with the press, Open Ticket
 * opens the ticket form (owner, 2026-10-29). With no device and no record, none.
 */
export function overviewActions(records: readonly WorkRecord[], device?: string): WorkAction[] {
  const open = records.filter((r) => r.stage !== "closed");
  if (open.length === 0) return device ? [action("doneNew", [device]), action("raiseTicket", [device]), action("helpNew", [device])] : [];
  const faults = open.filter((r) => r.stage === "fault").map((r) => r.id);
  const tickets = open.filter((r) => r.stage === "ticket").map((r) => r.id);
  const ids = open.map((r) => r.id);
  return [
    action("done", ids), ...notAProblem(open),
    tickets.length ? action("editTicket", [tickets[0]]) : action("openTicket", faults),
    ...needHelp(open),
  ];
}

/** ⚠️ NOT A PROBLEM ONLY BEFORE ANYONE TAKES IT ON (owner, 2026-11-04: on a ticket "it's irrelevant"; architecture
 *  review 23): the Tickets card left it out, but the same device's Inbox card offered it while its ticket was in
 *  progress, and pressing it closed that ticket as "Not a problem while it lasts". Offered on records none of which is a
 *  ticket (overviewActions; a Tickets card's records are all tickets: ticketActions offers none). */
function notAProblem(records: readonly WorkRecord[]): WorkAction[] {
  return records.length && records.every((r) => r.stage === "fault") ? [action("notAProblem", records.map((r) => r.id))] : [];
}

/** The buttons of a ticket in progress (a Tickets card), in the issue card's order by meaning: Close (its resolve form:
 *  work done), No action needed (nothing done) and Need help (the same "help" step as an issue card's: the VESTA Agent
 *  asks the owner to act) — each on every
 *  record of it. ⚠️ NO NOT A PROBLEM (owner, 2026-11-04: "it's irrelevant here"): a ticket is work someone took on;
 *  "not a problem" is said of an alert, on the Inbox's card, before anyone takes it on. */
export function ticketActions(records: readonly WorkRecord[]): WorkAction[] {
  const tickets = records.filter((r) => r.stage === "ticket");
  const ids = tickets.map((r) => r.id);
  return ids.length ? [action("ticketDone", ids), action("closeTicket", ids), ...needHelp(tickets)] : [];
}

/** A closed record's one button: "Reopen" — it is a fault again, back on the Inbox — when it may be taken back
 *  (`reopen`: faultConfirm.closedTold, the one rule of both Closed sections). */
export function closedActions(record: WorkRecord, reopen: boolean): WorkAction[] {
  return record.stage === "closed" && reopen ? [action("reopen", [record.id])] : [];
}

/** A stored record as a card's buttons see it. */
export const workRecord = (t: Pick<FmTicket, "id" | "status" | "updates">): WorkRecord => {
  const help = standingHelp(t);
  return { id: t.id, stage: stageOf(t), ...(help ? { help } : {}), ...(help && helpIsLatest(t) ? { helpInPill: true as const } : {}) };
};

// ── The counts ───────────────────────────────────────────────────────────────

/** What the Cockpit counts as open, in the unit it DRAWS: cards. `faults` — the devices with a fault nobody has taken
 *  on (each an Overview card); `tickets` — the Tickets tab's cards; `total` — the devices with
 *  anything open (each an issue card with a Done). ⚠️ ONE UNIT (architecture review, 2026-10-15): the pump's two
 *  faults taken on together showed one ticket card under "2 in progress", and readiness said "2 open tickets". The
 *  figures that must stay per record (a repair's mean time, in the monthly recap) are ticketStats'. */
interface OpenCounts { faults: number; tickets: number; total: number }

export function openCounts(records: readonly FmTicket[], cardOf: CardOf): OpenCounts {
  const cards = workByDevice(records.filter(isTicketOpen), cardOf).map((d) => d.records.map(workRecord));
  return {
    faults: cards.filter((rs) => rs.some((r) => r.stage === "fault")).length,
    tickets: ticketCards(records, cardOf).length,
    total: cards.filter((rs) => overviewActions(rs).length > 0).length,
  };
}
