// src/components/fm/WorkButtons.tsx
// A card's buttons for its faults and tickets — the Inbox's and the Tickets tab's (architecture review, 2026-10-16).
// WHICH buttons, on which records and with which question is fm/deviceWork's answer, and what a press does is
// fm/workPress's (both tested by value); this draws them and CARRIES OUT that outcome, for every tab alike: a question
// asked in place of the buttons, a write (its failure said under the card), the stage form (FaultStageModal), or a
// form the card does not hold, opened by the tab (`onOpen`). A Need help that stands says so.
//
// ⚠️ EACH TAB CARRIED OUT ITS OWN STEPS (architecture review round 6, 2026-10-30): the Inbox's card and the Tickets tab
// each wrote their own Need help, failure line and stage form around this, and neither showed what a Need help did —
// pressed, the card stayed exactly as it was. ⚠️ AND THIS FILE SPLIT THEM AGAIN (architecture review, 2026-11-13): its
// buttons carried out a close themselves, useCardWork a stage change and the writes, the caller a raise or an edit;
// every press now goes through fm/workPress.pressOutcome, carried out in one place (useCardWork.press).

import { useState, type ReactNode } from "react";
import { Ban, BellOff, Check, LifeBuoy, Pencil, RotateCcw, Wrench } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import { WORK_ACTIONS, helpLine, type WorkAction, type WorkActionKind } from "@/fm/deviceWork";
import type { HelpAsked } from "@/fm/fmEngine";
import type { FmTicket, FmTicketStatus } from "@/fm/fmTypes";
import { carryOut, pressOutcome, type RaisedFault, type WorkGo } from "@/fm/workPress";
import { momentText } from "@/utils/dateText";
import FaultStageModal from "./FaultStageModal";
import { CardAsk } from "./RecordCard";
import { backendFetch } from "@/auth/sessionLost";
import ProblemLine from "@/components/common/ProblemLine";

/** How a press reaches what the card does not hold: `raised`, the fault Done or Need help raises on a card with no
 *  record; `onOpen`, the form a raise or an edit opens (the tab's). `confirmed`: its question was answered yes. */
interface PressOpts { raised?: (entityId: string) => RaisedFault; onOpen?: (go: WorkGo) => void; confirmed?: boolean }

/** The presses of one list's cards, carried out — one per list, keyed by card, so a second card's question puts the
 *  first one's buttons back. */
interface CardWork {
  /** The card whose close question is being asked, and which button asked it (No action needed). */
  asking: { key: string; kind: WorkActionKind } | null;
  /** Why the last step on this card did not land; null when it did, or none was tried. */
  problemFor: (cardKey: string) => string | null;
  /** `action` pressed on the card: its outcome (fm/workPress.pressOutcome) carried out. */
  press: (cardKey: string, action: WorkAction, opts?: PressOpts) => void;
  cancel: () => void;
  /** The stage change whose form is open, and on which card. */
  staging: { key: string; tickets: FmTicket[]; to: FmTicketStatus } | null;
  endStaging: () => void;
}

export function useCardWork(): CardWork {
  const fm = useFmData();
  const [asking, setAsking] = useState<CardWork["asking"]>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const [staging, setStaging] = useState<CardWork["staging"]>(null);
  return {
    asking,
    problemFor: (key) => (problem?.key === key ? problem.text : null),
    press: (key, a, opts = {}) => {
      const o = pressOutcome(a, opts);
      if (o.does === "ask") { setProblem(null); setAsking({ key, kind: o.kind }); return; }
      if (o.does === "stage") {
        setStaging({ key, to: o.to, tickets: o.ids.map((id) => fm.data.tickets.find((t) => t.id === id)).filter((t): t is FmTicket => !!t) });
        return;
      }
      if (o.does === "go") { opts.onOpen?.(o.go); return; }
      if (o.does !== "write") return;
      // a write, and why it did not land on its card; on success the records say it: the card leaves its list, or
      // shows its Need help. A close ends its card's question.
      void (async () => {
        setProblem(null);
        const { done, note: why } = await carryOut(o.write, { ...fm, send: backendFetch });
        if (o.write.kind === "close") setAsking(null);
        if (!done && why) setProblem({ key, text: why });
      })();
    },
    cancel: () => setAsking(null),
    staging,
    endStaging: () => setStaging(null),
  };
}

/** ⚠️ ONE LOOK FOR EVERY BUTTON ON A CARD (owner, 2026-10-30: Done · Need help were filled green beside Open Ticket ·
 *  Close outlined, on the same Inbox): a card's work buttons and its record's buttons (AnnouncementContent.ButtonRow:
 *  VESTA's Done, the doorbell's Unlock) both draw with this. */
export const CARD_BUTTON = "btn";

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
 *  the Tickets tab's own and a device window's "Open Ticket" alike (WorkButton). Both words drawn when it has a short one: a card's row too narrow for
 *  every label in full shows the one word under the icon (07-facility.css, the row's width), any other place the label. */
function WorkLabel({ kind }: { kind: WorkActionKind }) {
  const { label, short } = WORK_ACTIONS[kind];
  return <>{ICON[kind]}{short ? <><span className="work-long">{label}</span><span className="work-short">{short}</span></> : label}</>;
}

/** ⚠️ ONE WORK BUTTON (owner, 2026-11-06: a device window's wrench, beside Edit, opened the same ticket form as the
 *  Cockpit's Open Ticket under another look): a segment of a card's bar, the Tickets tab's own Open Ticket and a device
 *  window's are each this one button, its icon and words WorkLabel's, its look CARD_BUTTON's (`main`: the card's main
 *  action, green). A change to it changes every place. */
export function WorkButton({ kind, onClick, main = false, ariaLabel }: {
  kind: WorkActionKind; onClick: () => void; main?: boolean; ariaLabel?: string;
}) {
  return (
    <button type="button" className={main ? `${CARD_BUTTON} fm-bar-main` : CARD_BUTTON} aria-label={ariaLabel} onClick={onClick}>
      <WorkLabel kind={kind} />
    </button>
  );
}

/** ⚠️ THE MAIN ACTION, FIRST AND GREEN (owner, 2026-11-05, the "Status on top" card): Done on a fault, Close on a
 *  ticket, the first segment of the card's bar and of its question's (fm/deviceWork lists it first). It was Edit Ticket
 *  in the accent (2026-11-04); the strip now says a ticket is in progress, in that green. */
const MAIN: Partial<Record<WorkActionKind, true>> = { done: true, doneNew: true, ticketDone: true };

export default function WorkButtons({ actions, cardKey, work, onOpen, raised, asked, name }: {
  actions: readonly WorkAction[];
  /** The card's key (deviceWork) — whose question is being asked, whose step did not land. */
  cardKey: string;
  work: CardWork;
  /** The forms the card does not hold, opened by its tab: Open Ticket on a card with no record (the ticket form for its
   *  device), Edit Ticket (the ticket's form). */
  onOpen?: (go: WorkGo) => void;
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
    <ProblemLine className="fm-row-confirm">{problem}</ProblemLine>
    {staging && <FaultStageModal tickets={staging.tickets} to={staging.to} onClose={work.endStaging} />}
  </>;
  if (actions.length === 0) return after || null;
  const confirming = work.asking?.key === cardKey ? actions.find((a) => a.kind === work.asking?.kind) : undefined;
  if (confirming && confirming.step.kind === "close" && confirming.step.ask) {
    const { question, confirmLabel } = confirming.step.ask;
    return <CardAsk question={question} confirmLabel={confirmLabel} icon={ICON[confirming.kind]}
      onConfirm={() => work.press(cardKey, confirming, { confirmed: true })} onCancel={work.cancel} />;
  }
  const buttons = actions.map((a) => (
    <WorkButton key={a.kind} kind={a.kind} main={!!MAIN[a.kind]}
      ariaLabel={a.step.kind === "close" && name ? `${a.label} “${name}”` : a.short ? a.label : undefined}
      onClick={() => work.press(cardKey, a, { raised, onOpen })} />
  ));
  return (
    <>
      {/* what a Need help did, on the card it was pressed on: the same line on the Inbox and the Tickets tab */}
      {asked && <div className="fm-work-asked">{helpLine(asked, momentText)}</div>}
      {/* ONE ROW, every card alike (owner, 2026-10-31, iPhone: Open Ticket dropped under Done · Need help; 2026-11-04:
          Open Ticket "on the same line"; 2026-11-05: the card's bar): each button a segment of the card's bar
          (RecordCard ActionsRow), their one words where it is too narrow for the labels (07-facility.css) */}
      {buttons}
      {after}
    </>
  );
}
