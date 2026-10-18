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
import { isTicketOpen, stageOf, type FmStage } from "./fmEngine";

// ── One card per device ──────────────────────────────────────────────────────

/** The card a thing belongs to: its DEVICE (deviceGroups.deviceOf — the owner's device groups, then the device
 *  registry), else the thing alone (a fault on no device, a whole-villa task). The Overview and the Tickets tab both
 *  key on this, so one device is one card in both. */
export function deviceWorkKey(device: string | undefined, ownId: string): string {
  return device ? `device:${device}` : `item:${ownId}`;
}

/** A record's card: its entity's device, else the record alone — the same key its Overview line gets (its line's id
 *  is `fault:<record id>`, config/attention.buildAttentionItems). */
export function recordWorkKey(t: Pick<FmTicket, "id" | "entityId">, deviceOf: (entityId: string) => string): string {
  return deviceWorkKey(t.entityId ? deviceOf(t.entityId) : undefined, `fault:${t.id}`);
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
export function workByDevice(records: readonly FmTicket[], deviceOf: (entityId: string) => string): DeviceWork[] {
  return groupByDevice(records, (t) => recordWorkKey(t, deviceOf)).map(({ key, items }) => ({ key, records: items }));
}

/** The Tickets tab's cards: the tickets in progress, one per device, the device whose latest was opened last first. */
export function ticketCards(records: readonly FmTicket[], deviceOf: (entityId: string) => string): DeviceWork[] {
  return workByDevice(records.filter((t) => stageOf(t) === "ticket")
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)), deviceOf);
}

// ── What a card's buttons do ─────────────────────────────────────────────────

/** Every button a card of open work can carry. Two Closes, because they close different things:
 *  `closeDevice` — an Overview card's: every fault and ticket of the device; `closeTicket` — a Tickets card's: that
 *  ticket's records. Both close with nothing done and no cost (fmCommands' closeTickets). */
export type WorkActionKind = "openTicket" | "editTicket" | "markResolved" | "closeDevice" | "closeAll" | "closeOne"
  | "closeTicket" | "reopen";

/** What a button does once pressed: record a stage change (FaultStageModal, to `to`), open the record's form, or —
 *  after its question — close the records with no action. */
export type WorkStep =
  | { kind: "stage"; to: FmTicketStatus }
  | { kind: "edit" }
  | { kind: "close"; question: string; confirmLabel: string };

export interface WorkActionSpec { label: string; step: WorkStep }

/** ONE wording per action. */
export const WORK_ACTIONS: Record<WorkActionKind, WorkActionSpec> = {
  openTicket: { label: "Open Ticket", step: { kind: "stage", to: "in_progress" } },
  editTicket: { label: "Edit Ticket", step: { kind: "edit" } },
  markResolved: { label: "Mark resolved", step: { kind: "stage", to: "resolved" } },
  closeDevice: { label: "Close", step: { kind: "close", question: "Close this? No action needed.", confirmLabel: "Close" } },
  // a card holding several problems: every one at once, or one alone (owner, 2026-10-18: #41 could not be closed
  // without #55 — architecture review "One problem, one card" #2)
  closeAll: { label: "Close all", step: { kind: "close", question: "Close all of them? No action needed.", confirmLabel: "Close all" } },
  closeOne: { label: "Close", step: { kind: "close", question: "Close this one? No action needed.", confirmLabel: "Close" } },
  closeTicket: { label: "Close", step: { kind: "close", question: "Close this ticket? Nothing was done — no cost is recorded.", confirmLabel: "Close ticket" } },
  reopen: { label: "Reopen", step: { kind: "stage", to: "open" } },
};

/** A button on a card: what it is, and the records it acts on (never empty). */
export interface WorkAction extends WorkActionSpec { kind: WorkActionKind; ids: string[] }

const action = (kind: WorkActionKind, ids: string[]): WorkAction => ({ kind, ids, ...WORK_ACTIONS[kind] });

/** A record as a card's buttons see it: which one, and where it stands. */
export interface WorkRecord { id: string; stage: FmStage }

/**
 * The buttons of an Overview card, from the device's open records (its own fault lines and those folded onto a live
 * state's line). None when it holds no record — a card that is only what Home Assistant reports has no button.
 * "Open Ticket" takes on its faults (one ticket for the device); once every one is a ticket, "Edit Ticket" opens the
 * first. "Close" closes them ALL, faults and tickets.
 */
export function overviewActions(records: readonly WorkRecord[], problems = 1): WorkAction[] {
  const open = records.filter((r) => r.stage !== "closed");
  if (open.length === 0) return [];
  const faults = open.filter((r) => r.stage === "fault").map((r) => r.id);
  const tickets = open.filter((r) => r.stage === "ticket").map((r) => r.id);
  return [
    faults.length ? action("openTicket", faults) : action("editTicket", [tickets[0]]),
    action(problems > 1 ? "closeAll" : "closeDevice", open.map((r) => r.id)),
  ];
}

/** One problem's own Close on a card holding several (`problems` lines with records): its records — its fault and the
 *  copies folded onto it. None on a card with one problem (the card's Close is that one), none on a line with no
 *  record (what the villa's system reports goes when the device is back). */
export function lineActions(records: readonly WorkRecord[], problems: number): WorkAction[] {
  const open = records.filter((r) => r.stage !== "closed").map((r) => r.id);
  return problems > 1 && open.length ? [action("closeOne", open)] : [];
}

/** The buttons of a ticket in progress (a Tickets card): "Mark resolved" and "Close" — both on every record of it. */
export function ticketActions(records: readonly WorkRecord[]): WorkAction[] {
  const ids = records.filter((r) => r.stage === "ticket").map((r) => r.id);
  return ids.length ? [action("markResolved", ids), action("closeTicket", ids)] : [];
}

/** A closed record's one button: "Reopen" — it is a fault again, back on the Overview. */
export function closedActions(record: WorkRecord): WorkAction[] {
  return record.stage === "closed" ? [action("reopen", [record.id])] : [];
}

/** A stored record as a card's buttons see it. */
export const workRecord = (t: Pick<FmTicket, "id" | "status">): WorkRecord => ({ id: t.id, stage: stageOf(t) });

// ── The counts ───────────────────────────────────────────────────────────────

/** What the Cockpit counts as open, in the unit it DRAWS: cards. `faults` — the devices with a fault nobody has taken
 *  on (each an Overview card with "Open Ticket"); `tickets` — the Tickets tab's cards; `total` — the devices with
 *  anything open (each an Overview card with a Close). ⚠️ ONE UNIT (architecture review, 2026-10-15): the pump's two
 *  faults taken on together showed one ticket card under "2 in progress", and readiness said "2 open tickets". The
 *  figures that must stay per record (a repair's mean time, the closed list) are ticketStats'. */
export interface OpenCounts { faults: number; tickets: number; total: number }

export function openCounts(records: readonly FmTicket[], deviceOf: (entityId: string) => string): OpenCounts {
  const cards = workByDevice(records.filter(isTicketOpen), deviceOf)
    .map((d) => overviewActions(d.records.map(workRecord)));
  return {
    faults: cards.filter((acts) => acts.some((a) => a.kind === "openTicket")).length,
    tickets: ticketCards(records, deviceOf).length,
    total: cards.filter((acts) => acts.length > 0).length,
  };
}
