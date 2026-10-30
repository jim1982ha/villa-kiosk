// src/components/fm/WorkButtons.tsx
// A card's buttons for its faults and tickets — the Inbox's and the Tickets tab's (architecture review, 2026-10-16).
// WHICH buttons, on which records and with which question is fm/deviceWork's answer (tested by value); this draws it,
// and CARRIES OUT every step a button names, for both tabs: Close asks its question in place of the buttons, a stage
// change opens its form (FaultStageModal), Need help writes its step, Done or Need help on a card with no record raises
// its fault in the same write. A step that did not land says why under the card; a Need help that stands says so.
//
// ⚠️ EACH TAB CARRIED OUT ITS OWN STEPS (architecture review round 6, 2026-10-30): the Inbox's card and the Tickets tab
// each wrote their own Need help, failure line and stage form around this, and neither showed what a Need help did —
// pressed, the card stayed exactly as it was. Only the two steps that leave the card (open a ticket's form, edit one)
// are still the caller's: they open a form the card does not hold.

import { useState, type ReactNode } from "react";
import { Pencil, Wrench } from "lucide-react";
import { useFmData, type FmDataContextValue } from "@/fm/FmDataContext";
import { DONE_STEP } from "@/fm/fmCommands";
import type { FmSaveOutcome } from "@/fm/fmSave";
import { helpLine, type WorkAction, type WorkActionKind } from "@/fm/deviceWork";
import type { HelpAsked } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import { momentText } from "@/utils/dateText";
import InlineConfirm from "@/components/common/InlineConfirm";
import FaultStageModal from "./FaultStageModal";

/** The fault a card with no record raises for its device (IssueCard.raisedFor). */
export type RaisedFault = Omit<FmTicket, "id" | "openedAt" | "status">;

/** The steps of one list's cards, carried out — one per list, keyed by card, so a second card's Close puts the first
 *  one's buttons back. */
export interface CardWork {
  /** The card whose Close question is being asked. */
  asking: string | null;
  /** Why the last step on this card did not land; null when it did, or none was tried. */
  problemFor: (cardKey: string) => string | null;
  ask: (cardKey: string) => void;
  cancel: () => void;
  /** `work`: resolved as work done (a completion), else closed with no action. */
  close: (cardKey: string, ids: readonly string[], work?: boolean) => Promise<void>;
  /** A step that stays on the card: a stage change (its form), Need help, or a raise with Done or Need help
   *  (`raised`: the fault to raise for the device the action names). */
  run: (cardKey: string, action: WorkAction, raised?: (entityId: string) => RaisedFault) => void;
  /** The stage change whose form is open, and on which card. */
  staging: { key: string; tickets: FmTicket[]; to: FmTicketStatus } | null;
  endStaging: () => void;
}

/** The write a step that stays on the card makes: Need help's "help" step on its records, a raise with Done or Need
 *  help in one write — null for a step that writes nothing by itself (a stage change: its form writes). Pure: the
 *  oracle drives it with stand-in writers (tests/oracles/live_issues.mjs). */
export function stepWrite(a: WorkAction, writers: Pick<FmDataContextValue, "helpTickets" | "addTicket">,
  raised?: (entityId: string) => RaisedFault): Promise<FmSaveOutcome> | null {
  const step = a.step;
  if (step.kind === "help") return writers.helpTickets(a.ids);
  if (step.kind === "raiseThen" && raised) return writers.addTicket(raised(a.ids[0]), { then: step.then });
  return null;
}

export function useCardWork(): CardWork {
  const fm = useFmData();
  const { data, closeTickets, advanceTickets } = fm;
  const [asking, setAsking] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const [staging, setStaging] = useState<CardWork["staging"]>(null);
  /** A write, and why it did not land on its card. On success the records say it: the card leaves its list, or
   *  shows its Need help. */
  const said = async (key: string, write: Promise<FmSaveOutcome>) => {
    setProblem(null);
    const { done, note: why } = await write;
    if (!done && why) setProblem({ key, text: why });
  };
  return {
    asking,
    problemFor: (key) => (problem?.key === key ? problem.text : null),
    ask: (key) => { setProblem(null); setAsking(key); },
    cancel: () => setAsking(null),
    close: async (key, ids, work) => {
      setProblem(null);
      const { done, note: why } = await (work ? advanceTickets(ids, "resolved", DONE_STEP) : closeTickets(ids));
      setAsking(null);
      if (!done && why) setProblem({ key, text: why });
    },
    run: (key, a, raised) => {
      const step = a.step;
      if (step.kind === "stage") {
        setStaging({ key, to: step.to,
          tickets: a.ids.map((id) => data.tickets.find((t) => t.id === id)).filter((t): t is FmTicket => !!t) });
        return;
      }
      const write = stepWrite(a, fm, raised);
      if (write) void said(key, write);
    },
    staging,
    endStaging: () => setStaging(null),
  };
}

/** ⚠️ ONE LOOK FOR EVERY BUTTON ON A CARD (owner, 2026-10-30: Done · Need help were filled green beside Open Ticket ·
 *  Close outlined, on the same Inbox): a card's work buttons and its record's buttons (AnnouncementContent.ButtonRow:
 *  VESTA's Done, the doorbell's Unlock) both draw with this. */
export const CARD_BUTTON = "btn ghost";

/** The Overview's buttons carry an icon (the Tickets tab's wrench for Open Ticket, owner 2026-10-14). */
const ICON: Partial<Record<WorkActionKind, ReactNode>> = {
  openTicket: <Wrench size={14} aria-hidden />,
  raiseTicket: <Wrench size={14} aria-hidden />,
  editTicket: <Pencil size={14} aria-hidden />,
};

/** Does pressing it open a form the card does not hold (the caller's `onOpen`)? */
const leavesCard = (a: WorkAction) => a.step.kind === "raise" || a.step.kind === "edit";

export default function WorkButtons({ actions, cardKey, work, onOpen, raised, asked, name, className }: {
  actions: readonly WorkAction[];
  /** The card's key (deviceWork) — whose question is being asked, whose step did not land. */
  cardKey: string;
  work: CardWork;
  /** Open Ticket on a card with no record (the ticket form for its device), Edit Ticket (the ticket's form). */
  onOpen?: (action: WorkAction) => void;
  /** The fault Done or Need help raises on a card with no record. */
  raised?: (entityId: string) => RaisedFault;
  /** Its Need help that nothing has answered yet (deviceWork.helpAsked): said above the buttons. */
  asked?: HelpAsked | null;
  /** The card's title, for a screen reader's "Close “…”" on the Overview's Close. */
  name?: string;
  /** Wraps the buttons (the Overview's row of them); none — they sit straight in the card's actions. */
  className?: string;
}) {
  const problem = work.problemFor(cardKey);
  const staging = work.staging?.key === cardKey ? work.staging : null;
  const after = (problem || staging) && <>
    {problem && <div className="fm-inline-error fm-row-confirm" role="alert">{problem}</div>}
    {staging && <FaultStageModal tickets={staging.tickets} to={staging.to} onClose={work.endStaging} />}
  </>;
  if (actions.length === 0) return after || null;
  const confirming = work.asking === cardKey ? actions.find((a) => a.step.kind === "close") : undefined;
  if (confirming && confirming.step.kind === "close") {
    const { question, confirmLabel, work: asWork } = confirming.step;
    return <InlineConfirm question={question} confirmLabel={confirmLabel}
      onConfirm={() => work.close(cardKey, confirming.ids, asWork)} onCancel={work.cancel} />;
  }
  const buttons = actions.map((a) => (
    <button key={a.kind} type="button" className={CARD_BUTTON}
      aria-label={a.step.kind === "close" && name ? `${a.label} “${name}”` : undefined}
      onClick={() => (a.step.kind === "close" ? work.ask(cardKey) : leavesCard(a) ? onOpen?.(a) : work.run(cardKey, a, raised))}>
      {ICON[a.kind]}{ICON[a.kind] ? " " : null}{a.label}
    </button>
  ));
  return (
    <>
      {/* what a Need help did, on the card it was pressed on: the same line on the Inbox and the Tickets tab */}
      {asked && <div className="fm-work-asked">{helpLine(asked, momentText)}</div>}
      {className ? <div className={className}>{buttons}</div> : buttons}
      {after}
    </>
  );
}
