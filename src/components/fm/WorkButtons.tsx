// src/components/fm/WorkButtons.tsx
// A card's buttons for its faults and tickets — the Inbox's and the Tickets tab's (architecture review, 2026-10-16).
// WHICH buttons, on which records and with which question is fm/deviceWork's answer (tested by value); this draws it,
// and CARRIES OUT every step a button names, for both tabs: No action needed and Done ask their question in place of the buttons
// (Not a problem closes as pressed), a stage
// change opens its form (FaultStageModal), Need help writes its step, Done or Need help on a card with no record raises
// its fault in the same write. A step that did not land says why under the card; a Need help that stands says so.
//
// ⚠️ EACH TAB CARRIED OUT ITS OWN STEPS (architecture review round 6, 2026-10-30): the Inbox's card and the Tickets tab
// each wrote their own Need help, failure line and stage form around this, and neither showed what a Need help did —
// pressed, the card stayed exactly as it was. Only the two steps that leave the card (open a ticket's form, edit one)
// are still the caller's: they open a form the card does not hold.

import { useState, type ReactNode } from "react";
import { Ban, BellOff, Check, LifeBuoy, Pencil, RotateCcw, Wrench } from "lucide-react";
import { useFmData, type FmDataContextValue } from "@/fm/FmDataContext";
import { DONE_STEP } from "@/fm/fmCommands";
import type { FmSaveOutcome } from "@/fm/fmSave";
import { WORK_ACTIONS, helpLine, type WorkAction, type WorkActionKind } from "@/fm/deviceWork";
import type { HelpAsked } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import { momentText } from "@/utils/dateText";
import InlineConfirm from "@/components/common/InlineConfirm";
import FaultStageModal from "./FaultStageModal";

/** The fault a card with no record raises for its device (IssueCard.raisedFor). */
export type RaisedFault = Omit<FmTicket, "id" | "openedAt" | "status">;

/** The steps of one list's cards, carried out — one per list, keyed by card, so a second card's Close puts the first
 *  one's buttons back. */
interface CardWork {
  /** The card whose close question is being asked, and which button asked it (Done, No action needed). */
  asking: { key: string; kind: WorkActionKind } | null;
  /** Why the last step on this card did not land; null when it did, or none was tried. */
  problemFor: (cardKey: string) => string | null;
  ask: (cardKey: string, kind: WorkActionKind) => void;
  cancel: () => void;
  /** `work`: resolved as work done (a completion), else closed with no action; `lasting`: closed with no action as
   *  "Not a problem while it lasts" (FmTicketUpdate.lasting). */
  close: (cardKey: string, ids: readonly string[], work?: boolean, lasting?: boolean) => Promise<void>;
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
  const [asking, setAsking] = useState<CardWork["asking"]>(null);
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
    ask: (key, kind) => { setProblem(null); setAsking({ key, kind }); },
    cancel: () => setAsking(null),
    close: async (key, ids, work, lasting) => {
      setProblem(null);
      const { done, note: why } = await (lasting ? closeTickets(ids, true)
        : work ? advanceTickets(ids, "resolved", DONE_STEP) : closeTickets(ids));
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

/** ⚠️ EVERY WORK BUTTON CARRIES AN ICON (owner, 2026-11-04: "use 1 word label and icon in the button", on a phone,
 *  and "consistently adjust cards on laptop screens"): it had been Open Ticket's wrench (owner, 2026-10-14) and Edit
 *  Ticket's pencil only. The same icon for the same act on every card. */
const ICON: Record<WorkActionKind, ReactNode> = {
  done: <Check size={14} aria-hidden />,
  doneNew: <Check size={14} aria-hidden />,
  ticketDone: <Check size={14} aria-hidden />,
  needHelp: <LifeBuoy size={14} aria-hidden />,
  helpNew: <LifeBuoy size={14} aria-hidden />,
  notAProblem: <BellOff size={14} aria-hidden />,
  openTicket: <Wrench size={14} aria-hidden />,
  raiseTicket: <Wrench size={14} aria-hidden />,
  editTicket: <Pencil size={14} aria-hidden />,
  closeTicket: <Ban size={14} aria-hidden />,
  reopen: <RotateCcw size={14} aria-hidden />,
};

/** What a work button says: its icon, then its words (fm/deviceWork's ONE wording per action) — a card's buttons and
 *  the Tickets tab's own "Open Ticket" alike. Both words drawn when it has a short one: a card's row too narrow for
 *  every label in full shows the one word under the icon (07-facility.css, the row's width), any other place the label. */
export function WorkLabel({ kind }: { kind: WorkActionKind }) {
  const { label, short } = WORK_ACTIONS[kind];
  return <>{ICON[kind]}{short ? <><span className="work-long">{label}</span><span className="work-short">{short}</span></> : label}</>;
}

/** The buttons drawn in the accent (owner, 2026-11-04: Edit Ticket "with this same green accent style", the colour of
 *  its ticket's pill: faultNotes.stagePillClass). */
const ACCENT: Partial<Record<WorkActionKind, true>> = { editTicket: true };

/** Does pressing it open a form the card does not hold (the caller's `onOpen`)? */
const leavesCard = (a: WorkAction) => a.step.kind === "raise" || a.step.kind === "edit";

export default function WorkButtons({ actions, cardKey, work, onOpen, raised, asked, name }: {
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
}) {
  const problem = work.problemFor(cardKey);
  const staging = work.staging?.key === cardKey ? work.staging : null;
  const after = (problem || staging) && <>
    {problem && <div className="fm-inline-error fm-row-confirm" role="alert">{problem}</div>}
    {staging && <FaultStageModal tickets={staging.tickets} to={staging.to} onClose={work.endStaging} />}
  </>;
  if (actions.length === 0) return after || null;
  const confirming = work.asking?.key === cardKey ? actions.find((a) => a.kind === work.asking?.kind) : undefined;
  if (confirming && confirming.step.kind === "close" && confirming.step.ask) {
    const { ask: { question, confirmLabel }, work: asWork, lasting } = confirming.step;
    return <InlineConfirm question={question} confirmLabel={confirmLabel}
      onConfirm={() => work.close(cardKey, confirming.ids, asWork, lasting)} onCancel={work.cancel} />;
  }
  /** A close with a question asks it; one without (Not a problem) closes as pressed. */
  const closing = (a: WorkAction) => {
    const step = a.step;
    if (step.kind !== "close") return undefined;
    return step.ask ? () => work.ask(cardKey, a.kind) : () => void work.close(cardKey, a.ids, step.work, step.lasting);
  };
  const buttons = actions.map((a) => (
    <button key={a.kind} type="button" className={ACCENT[a.kind] ? "btn primary" : CARD_BUTTON}
      aria-label={a.step.kind === "close" && name ? `${a.label} “${name}”` : a.short ? a.label : undefined}
      onClick={closing(a) ?? (() => (leavesCard(a) ? onOpen?.(a) : work.run(cardKey, a, raised)))}>
      <WorkLabel kind={a.kind} />
    </button>
  ));
  return (
    <>
      {/* what a Need help did, on the card it was pressed on: the same line on the Inbox and the Tickets tab */}
      {asked && <div className="fm-work-asked">{helpLine(asked, momentText)}</div>}
      {/* ONE ROW, every card alike (owner, 2026-10-31, iPhone: Open Ticket dropped under Done · Need help; 2026-11-04:
          Open Ticket "on the same line"): the buttons are grouped in a row of their own, which the card's icon column
          lends its width, their one words under their icons where it is too narrow for the labels (07-facility.css) */}
      <div className="fm-work-row">{buttons}</div>
      {after}
    </>
  );
}
