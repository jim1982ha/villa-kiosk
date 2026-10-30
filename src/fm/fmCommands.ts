// src/fm/fmCommands.ts
// EVERY change to the Facility record, as one pure step: applyFmCommand(data, command, { now, id, by }). The store
// (FmDataContext) only says WHICH command and saves the result; who did it, when, and the new ids are stamped here,
// the same way for every write.
//
// ⚠️ THE WRITES WERE EIGHTEEN SEPARATE CLOSURES (architecture review, 2026-10-14). Five of them were edits written on
// the spot in the store, outside the engine, and one forgot what every other fault write records: a fault a person
// RAISED carried no step and no author — its card read "Opened 14:20" while its close read "by Facility manager", and
// the VESTA Agent's notes had nobody to name. One function now, tested by value (tests/oracles/fm_commands.mjs).

import type { FmCompletion, FmCost, FmData, FmSavedDocument, FmSchedule, FmTicket, FmTicketStatus } from "./fmTypes";
import {
  withCompletion, withoutCompletion, withoutCost, withoutTicket, withTicketPatch, withTicketsAdvanced, withTicketsClosed,
  withTicketsHelped,
  type FmStamp, type TicketCost, type TicketStep,
} from "./fmEngine";

export type FmCommand =
  | { type: "addSchedule"; schedule: Omit<FmSchedule, "id" | "createdAt"> }
  | { type: "updateSchedule"; id: string; patch: Partial<FmSchedule> }
  | { type: "removeSchedule"; id: string }
  | { type: "removeAllSchedules" }
  | { type: "logCompletion"; completion: Omit<FmCompletion, "id" | "costId">; cost?: TicketCost }
  | { type: "addCost"; cost: Omit<FmCost, "id"> }
  | { type: "updateCost"; id: string; patch: Partial<FmCost> }
  | { type: "removeCost"; id: string }
  /** `asTicket`: a person's "Open a ticket" (owner, 2026-10-14) — the record starts as a TICKET in progress, taken on by
   *  whoever opened it; without it, a FAULT waiting on the Overview (a guest's report). `then`: Done or Need help
   *  pressed on a card with no record yet (owner, 2026-10-30) — the fault raised and, in the same write, closed or
   *  asked for help on. */
  | { type: "addTicket"; ticket: Omit<FmTicket, "id" | "openedAt" | "status">; asTicket?: boolean; then?: "close" | "help" }
  | { type: "updateTicket"; id: string; patch: Partial<FmTicket> }
  | { type: "advanceTickets"; ids: readonly string[]; to: FmTicketStatus; step: TicketStep; cost?: TicketCost }
  | { type: "closeTickets"; ids: readonly string[] }
  | { type: "helpTickets"; ids: readonly string[] }
  | { type: "removeTicket"; id: string }
  | { type: "removeCompletion"; id: string }
  | { type: "saveDocument"; doc: Omit<FmSavedDocument, "id" | "generatedAt"> }
  | { type: "removeDocument"; id: string };

/** Who and when: the clock and ids (FmStamp), and the signed-in profile that did it ("Owner", "Guest"…), stamped on
 *  every step of a fault — the card's "by …" and the VESTA Agent's notes read it. */
export type FmActor = FmStamp & { by?: string };

export function applyFmCommand(d: FmData, c: FmCommand, k: FmActor): FmData {
  const by = k.by;
  switch (c.type) {
    case "addSchedule":
      return { ...d, schedules: [...d.schedules, { ...c.schedule, id: k.id("sc"), createdAt: k.now }] };
    case "updateSchedule":
      return { ...d, schedules: d.schedules.map((s) => (s.id === c.id ? { ...s, ...c.patch } : s)) };
    case "removeSchedule":
      return { ...d, schedules: d.schedules.filter((s) => s.id !== c.id) };
    case "removeAllSchedules":
      // completions already logged stay: they are evidence of work done, not of the task still existing
      return { ...d, schedules: [] };
    case "logCompletion":
      return withCompletion(d, c.completion, c.cost, k);
    case "addCost":
      return { ...d, costs: [...d.costs, { ...c.cost, id: k.id("co") }] };
    case "updateCost":
      return { ...d, costs: d.costs.map((x) => (x.id === c.id ? { ...x, ...c.patch } : x)) };
    case "removeCost":
      return withoutCost(d, c.id);
    case "addTicket": {
      // its first step says who opened it and how, as every later step says who did it
      const status: FmTicketStatus = c.asTicket ? "in_progress" : "open";
      const id = k.id("tk");
      const added: FmData = { ...d, tickets: [...d.tickets, {
        ...c.ticket, id, status, openedAt: k.now,
        updates: [{ at: k.now, status, photoIds: [], ...(by ? { by } : {}) }],
      }] };
      return c.then === "close" ? withTicketsClosed(added, [id], k, by)
        : c.then === "help" ? withTicketsHelped(added, [id], k, by) : added;
    }
    case "updateTicket":
      return withTicketPatch(d, c.id, c.patch, k, by);
    case "advanceTickets":
      return withTicketsAdvanced(d, c.ids, c.to, c.step, c.cost, k, by);
    case "closeTickets":
      return withTicketsClosed(d, c.ids, k, by);
    case "helpTickets":
      return withTicketsHelped(d, c.ids, k, by);
    case "removeTicket":
      return withoutTicket(d, c.id);
    case "removeCompletion":
      return withoutCompletion(d, c.id);
    case "saveDocument":
      return { ...d, savedDocuments: [...d.savedDocuments, { ...c.doc, id: k.id("doc"), generatedAt: k.now }] };
    case "removeDocument":
      return { ...d, savedDocuments: d.savedDocuments.filter((r) => r.id !== c.id) };
  }
}
