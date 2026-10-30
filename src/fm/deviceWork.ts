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
import { isTicketOpen, stageOf, standingHelp, type FmStage, type HelpAsked } from "./fmEngine";

// ── One card per device ──────────────────────────────────────────────────────

/** The card a thing belongs to: its DEVICE (deviceGroups.deviceOf — the owner's device groups, then the device
 *  registry), else the thing alone (a fault on no device, a whole-villa task). The Overview and the Tickets tab both
 *  key on this, so one device is one card in both. */
export function deviceWorkKey(device: string | undefined, ownId: string): string {
  return device ? `device:${device}` : `item:${ownId}`;
}

/** A record's card: its entity's device, else the record alone — the same key its Overview line gets (its line's id
 *  is `fault:<record id>`, config/attention.buildAttentionItems). `deviceOfRecord`: the villa's one answer to "which
 *  device does this record's entity field name" (deviceGroups.recordDeviceOf — a list of several included). */
export function recordWorkKey(t: Pick<FmTicket, "id" | "entityId">, deviceOfRecord: (field: string) => string): string {
  return deviceWorkKey(t.entityId ? deviceOfRecord(t.entityId) : undefined, `fault:${t.id}`);
}

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
export function workByDevice(records: readonly FmTicket[], deviceOfRecord: (field: string) => string): DeviceWork[] {
  return groupByDevice(records, (t) => recordWorkKey(t, deviceOfRecord)).map(({ key, items }) => ({ key, records: items }));
}

/** The Tickets tab's cards: the tickets in progress, one per device, the device whose latest was opened last first. */
export function ticketCards(records: readonly FmTicket[], deviceOfRecord: (field: string) => string): DeviceWork[] {
  return workByDevice(records.filter((t) => stageOf(t) === "ticket")
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)), deviceOfRecord);
}

// ── What a card's buttons do ─────────────────────────────────────────────────

/** Every button a card of open work can carry. An issue card's (the Inbox's): Done · Need help · Open Ticket (or Edit
 *  Ticket), `doneNew` / `helpNew` on a card with no record yet (only what the villa's system reports: a fault for its
 *  device is raised with the press). A Tickets card's: Done · Need help · Close (`ticketDone`: the resolve form, work
 *  done; `closeTicket`: that ticket's records closed with nothing done and no cost, fmCommands' closeTickets). */
export type WorkActionKind = "done" | "needHelp" | "doneNew" | "helpNew" | "openTicket" | "raiseTicket" | "editTicket"
  | "ticketDone" | "closeTicket" | "reopen";

/** What a button does once pressed: record a stage change (FaultStageModal, to `to`), open the record's form, open
 *  the ticket form pointed at a device, ask for help on the records (a "help" step: the VESTA Agent asks the owner to
 *  act), raise a fault for the device and close it or ask for help on it in the same write (`then`), or — after its
 *  question — close the records with no action. */
export type WorkStep =
  | { kind: "stage"; to: FmTicketStatus }
  | { kind: "edit" }
  | { kind: "raise" }
  | { kind: "help" }
  | { kind: "raiseThen"; then: "done" | "help" }
  /** `work`: the records are resolved as work done (a completion with who did it, in Recent work, as a Done on Telegram
   *  records it: the Agent's resolve_ticket); without, closed with no action (no completion, no cost). */
  | { kind: "close"; question: string; confirmLabel: string; work?: true };

export interface WorkActionSpec { label: string; step: WorkStep }

/** The words Done and Need help say on every card, the Inbox's and the Tickets tab's alike. */
const DONE = "Done";
const NEED_HELP = "Need help";

/** ONE wording per action. */
export const WORK_ACTIONS: Record<WorkActionKind, WorkActionSpec> = {
  // ⚠️ DONE · NEED HELP · OPEN TICKET ON EVERY ISSUE CARD (owner, 2026-10-30: "a unique configuration … Done and Close
  // shall do the same thing"): an alert's card had VESTA's Done · Need help, a fault's Open Ticket · Close
  // ⚠️ A DONE IS WORK DONE, WHEREVER IT IS PRESSED (owner, 2026-10-30, review round 4: Done on Telegram filed a
  // completion in Recent work, the same Done on the Cockpit card a "Closed without action" gone after 90 days)
  done: { label: DONE, step: { kind: "close", question: "Done? VESTA checks it again before it closes.", confirmLabel: DONE, work: true } },
  needHelp: { label: NEED_HELP, step: { kind: "help" } },
  doneNew: { label: DONE, step: { kind: "raiseThen", then: "done" } },
  helpNew: { label: NEED_HELP, step: { kind: "raiseThen", then: "help" } },
  openTicket: { label: "Open Ticket", step: { kind: "stage", to: "in_progress" } },
  // a card with no record yet (only what the villa's system reports): the same words, the ticket form for its device
  raiseTicket: { label: "Open Ticket", step: { kind: "raise" } },
  editTicket: { label: "Edit Ticket", step: { kind: "edit" } },
  // ⚠️ THE TICKETS TAB SAYS DONE TOO (owner, 2026-10-30: "I agree with your recommendation"): its "Mark resolved" was
  // the same work done as the Inbox's Done, in other words; it keeps its form (what was done, cost, photos)
  ticketDone: { label: DONE, step: { kind: "stage", to: "resolved" } },
  closeTicket: { label: "Close", step: { kind: "close", question: "Close this ticket? Nothing was done, no cost is recorded.", confirmLabel: "Close ticket" } },
  reopen: { label: "Reopen", step: { kind: "stage", to: "open" } },
};

/** A button on a card: what it is, and the records it acts on (never empty) — raiseTicket's: the device. */
export interface WorkAction extends WorkActionSpec { kind: WorkActionKind; ids: string[] }

const action = (kind: WorkActionKind, ids: string[]): WorkAction => ({ kind, ids, ...WORK_ACTIONS[kind] });

/** A record as a card's buttons see it: which one, where it stands, and the Need help on it nothing has answered yet
 *  (fmEngine.standingHelp). */
export interface WorkRecord { id: string; stage: FmStage; help?: HelpAsked }

/** ⚠️ NEED HELP IS ASKED ONCE (architecture review round 6, 2026-10-30: the card looked the same after the press, so it
 *  was pressed again and the owner asked twice): a card's Need help acts on the records nobody has asked about yet, and
 *  is not offered once every one of them has been. */
function needHelp(records: readonly WorkRecord[]): WorkAction[] {
  const ids = records.filter((r) => !r.help).map((r) => r.id);
  return ids.length ? [action("needHelp", ids)] : [];
}

/** The Need help a card shows as asked: the latest standing one among its records, null with none. */
export function helpAsked(records: readonly WorkRecord[]): HelpAsked | null {
  return records.reduce<HelpAsked | null>((last, r) => (r.help && (!last || Date.parse(r.help.at) >= Date.parse(last.at))
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
 * a live state's line): Done · Need help · Open Ticket, the same three on every card. Done closes them ALL, faults and
 * tickets, each read again by the VESTA Agent ("one Done closes everything on the card", owner 2026-10-30, in place of
 * each line's own Close of 2026-10-18); Need help writes a "help" step on each not asked about yet (none left: no
 * Need help); Open Ticket takes on its faults (one ticket for the device), "Edit Ticket" once every one is a ticket. A card holding no record — only what the villa's
 * system reports — has the same three for its `device`: Done and Need help raise its fault with the press, Open Ticket
 * opens the ticket form (owner, 2026-10-29). With no device and no record, none.
 */
export function overviewActions(records: readonly WorkRecord[], device?: string): WorkAction[] {
  const open = records.filter((r) => r.stage !== "closed");
  if (open.length === 0) return device ? [action("doneNew", [device]), action("helpNew", [device]), action("raiseTicket", [device])] : [];
  const faults = open.filter((r) => r.stage === "fault").map((r) => r.id);
  const tickets = open.filter((r) => r.stage === "ticket").map((r) => r.id);
  const ids = open.map((r) => r.id);
  return [
    action("done", ids), ...needHelp(open),
    faults.length ? action("openTicket", faults) : action("editTicket", [tickets[0]]),
  ];
}

/** The buttons of a ticket in progress (a Tickets card): Done (its resolve form: work done), Need help (the same "help"
 *  step as an issue card's: the VESTA Agent asks the owner to act) and Close (nothing done) — each on every record of it. */
export function ticketActions(records: readonly WorkRecord[]): WorkAction[] {
  const tickets = records.filter((r) => r.stage === "ticket");
  const ids = tickets.map((r) => r.id);
  return ids.length ? [action("ticketDone", ids), ...needHelp(tickets), action("closeTicket", ids)] : [];
}

/** A closed record's one button: "Reopen" — it is a fault again, back on the Overview. */
export function closedActions(record: WorkRecord): WorkAction[] {
  return record.stage === "closed" ? [action("reopen", [record.id])] : [];
}

/** A stored record as a card's buttons see it. */
export const workRecord = (t: Pick<FmTicket, "id" | "status" | "updates">): WorkRecord => {
  const help = standingHelp(t);
  return { id: t.id, stage: stageOf(t), ...(help ? { help } : {}) };
};

// ── The counts ───────────────────────────────────────────────────────────────

/** What the Cockpit counts as open, in the unit it DRAWS: cards. `faults` — the devices with a fault nobody has taken
 *  on (each an Overview card with "Open Ticket"); `tickets` — the Tickets tab's cards; `total` — the devices with
 *  anything open (each an issue card with a Done). ⚠️ ONE UNIT (architecture review, 2026-10-15): the pump's two
 *  faults taken on together showed one ticket card under "2 in progress", and readiness said "2 open tickets". The
 *  figures that must stay per record (a repair's mean time, the closed list) are ticketStats'. */
export interface OpenCounts { faults: number; tickets: number; total: number }

export function openCounts(records: readonly FmTicket[], deviceOfRecord: (field: string) => string): OpenCounts {
  const cards = workByDevice(records.filter(isTicketOpen), deviceOfRecord)
    .map((d) => overviewActions(d.records.map(workRecord)));
  return {
    faults: cards.filter((acts) => acts.some((a) => a.kind === "openTicket")).length,
    tickets: ticketCards(records, deviceOfRecord).length,
    total: cards.filter((acts) => acts.length > 0).length,
  };
}
