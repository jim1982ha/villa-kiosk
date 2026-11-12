// src/fm/workPress.ts
// WHAT A WORK BUTTON'S PRESS DOES (architecture review, 2026-11-13): "this action pressed on this card" turned into its
// outcome, for every tab that draws work buttons alike: a question asked in place of the buttons, a write (a close, a
// Need help, a fault raised with the press, a press on the villa's own visit card), the stage form to open, or a
// form the card does not hold (the ticket form for a device, a ticket's own form). fm/deviceWork says WHICH buttons a
// card has and the step each names; this says what pressing one does; components/fm/WorkButtons only carries it out.
//
// ⚠️ SPLIT FIVE WAYS: a close was carried out by WorkButtons' own `closing`, a raise or an edit by the caller's `onOpen`
// (the Inbox's card passed one, the Tickets tab none), a stage change by useCardWork opening its form, a visit's press
// and a Need help by two writers beside it. Pure: a check presses each button by calling this with an action.

import type { FmSaveOutcome } from "./fmSave";
import type { FmTicket, FmTicketStatus } from "./fmTypes";
import { DONE_STEP } from "./fmCommands";
import type { WorkAction, WorkActionKind } from "./deviceWork";
import { PRESS_SAID, pressVisit } from "@/messages/announcements";

/** The fault a card with no record raises for its device (cockpit/IssueCard.raisedFor). */
export type RaisedFault = Omit<FmTicket, "id" | "openedAt" | "status">;

/** A write a press makes: close the records (`work`: as work done, a completion; `lasting`: "Not a problem while it
 *  lasts"; neither: no action), ask for help on them, raise the device's fault and close it or ask for help on it in
 *  the same write, or send the villa its own visit card's press (`key` the card, `option` the villa's button). */
export type WorkWrite =
  | { kind: "close"; ids: readonly string[]; work?: true; lasting?: true }
  | { kind: "help"; ids: readonly string[] }
  | { kind: "raise"; fault: RaisedFault; then: "done" | "help" }
  | { kind: "visit"; key: string; option: string };

/** A form the card does not hold, opened by the tab drawing it: the ticket form pointed at a device (`id` the device),
 *  or a ticket's own form (`id` the ticket). */
export interface WorkGo { to: "raiseTicket" | "editTicket"; id: string }

/** What a press does. */
export type PressOutcome =
  /** its question, in place of the card's buttons; its yes is the same press `confirmed` */
  | { does: "ask"; kind: WorkActionKind; question: string; confirmLabel: string }
  | { does: "write"; write: WorkWrite }
  /** the stage form (FaultStageModal) on the records, to `to` */
  | { does: "stage"; ids: readonly string[]; to: FmTicketStatus }
  | { does: "go"; go: WorkGo }
  /** nothing to do: a raise with no fault to raise (the card names no device) */
  | { does: "nothing" };

/** What pressing `a` does. `confirmed`: its question was answered yes (a close that asks first); `raised`: the fault a
 *  card with no record raises for the device the action names. */
export function pressOutcome(a: WorkAction, opts: { confirmed?: boolean; raised?: (entityId: string) => RaisedFault } = {}): PressOutcome {
  const step = a.step;
  switch (step.kind) {
    case "close":
      // a close with a question asks it first (No action needed); one without closes as pressed (Done, Not a problem)
      if (step.ask && !opts.confirmed) return { does: "ask", kind: a.kind, ...step.ask };
      return { does: "write", write: { kind: "close", ids: a.ids, ...(step.work ? { work: true as const } : {}),
        ...(step.lasting ? { lasting: true as const } : {}) } };
    case "help": return { does: "write", write: { kind: "help", ids: a.ids } };
    case "raiseThen":
      return opts.raised ? { does: "write", write: { kind: "raise", fault: opts.raised(a.ids[0]), then: step.then } } : { does: "nothing" };
    case "visit": return { does: "write", write: { kind: "visit", key: a.ids[0], option: step.option } };
    case "stage": return { does: "stage", ids: a.ids, to: step.to };
    case "raise": return { does: "go", go: { to: "raiseTicket", id: a.ids[0] } };
    case "edit": return { does: "go", go: { to: "editTicket", id: a.ids[0] } };
  }
}

/** Who carries out a write: the Facility records' writers (FmDataContext), and how a visit's press reaches the add-on
 *  (backendFetch; a check passes its own). */
export interface WorkWriters {
  closeTickets: (ids: readonly string[], lasting?: boolean) => Promise<FmSaveOutcome>;
  advanceTickets: (ids: readonly string[], to: FmTicketStatus, step: { photoIds: string[] }) => Promise<FmSaveOutcome>;
  helpTickets: (ids: readonly string[]) => Promise<FmSaveOutcome>;
  addTicket: (t: RaisedFault, opts: { then: "done" | "help" }) => Promise<FmSaveOutcome>;
  send: Parameters<typeof pressVisit>[2];
}

/** A write carried out, and whether it landed: `note` why not, said under the card (a visit's press not sent:
 *  PRESS_SAID). */
export function carryOut(w: WorkWrite, writers: WorkWriters): Promise<Pick<FmSaveOutcome, "done" | "note">> {
  switch (w.kind) {
    case "close":
      return w.lasting ? writers.closeTickets(w.ids, true)
        : w.work ? writers.advanceTickets(w.ids, "resolved", DONE_STEP) : writers.closeTickets(w.ids);
    case "help": return writers.helpTickets(w.ids);
    case "raise": return writers.addTicket(w.fault, { then: w.then });
    case "visit":
      return pressVisit(w.key, w.option, writers.send)
        .then(({ outcome }) => ({ done: outcome === "sent", note: outcome === "sent" ? null : PRESS_SAID[outcome] }));
  }
}
