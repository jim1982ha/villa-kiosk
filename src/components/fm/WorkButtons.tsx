// src/components/fm/WorkButtons.tsx
// A card's buttons for its faults and tickets — the Overview's and the Tickets tab's (architecture review,
// 2026-10-16). WHICH buttons, on which records and with which question is fm/deviceWork's answer (tested by value);
// this draws it, and holds the one close-confirm-error flow both tabs share: Close asks its question in place of the
// buttons, Cancel puts them back, a close that did not land says why under the card. It was written out in each tab.

import { useState, type ReactNode } from "react";
import { Pencil, Wrench, X } from "lucide-react";
import { useFmData } from "@/fm/FmDataContext";
import type { WorkAction, WorkActionKind } from "@/fm/deviceWork";
import InlineConfirm from "@/components/common/InlineConfirm";

/** Which card is asking its Close question, and why the last close did not land — one per list, keyed by card, so a
 *  second card's Close puts the first one's buttons back. */
export interface ConfirmedClose {
  asking: string | null;
  /** Why the last close on this card did not land; null when it did, or none was tried. */
  problemFor: (cardKey: string) => string | null;
  ask: (cardKey: string) => void;
  cancel: () => void;
  close: (cardKey: string, ids: readonly string[]) => Promise<void>;
}

export function useConfirmedClose(): ConfirmedClose {
  const { closeTickets } = useFmData();
  const [asking, setAsking] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  return {
    asking,
    problemFor: (key) => (problem?.key === key ? problem.text : null),
    ask: (key) => { setProblem(null); setAsking(key); },
    cancel: () => setAsking(null),
    close: async (key, ids) => {
      setProblem(null);
      const { done, note: why } = await closeTickets(ids);
      // On success the card's records leave its list; only a failure stays to say so.
      setAsking(null);
      if (!done && why) setProblem({ key, text: why });
    },
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
  closeDevice: <X size={14} />,
  closeAll: <X size={14} />,
  closeOne: <X size={14} />,
};

export default function WorkButtons({ actions, cardKey, closer, onAction, name, className }: {
  actions: readonly WorkAction[];
  /** The card's key (deviceWork) — whose question is being asked. */
  cardKey: string;
  closer: ConfirmedClose;
  /** A button that is not a Close: record its stage change, or open its record's form. */
  onAction: (action: WorkAction) => void;
  /** The card's title, for a screen reader's "Close “…”" on the Overview's Close. */
  name?: string;
  /** Wraps the buttons (the Overview's row of them); none — they sit straight in the card's actions. */
  className?: string;
}) {
  if (actions.length === 0) return null;
  const asked = closer.asking === cardKey ? actions.find((a) => a.step.kind === "close") : undefined;
  if (asked && asked.step.kind === "close") {
    return <InlineConfirm question={asked.step.question} confirmLabel={asked.step.confirmLabel}
      onConfirm={() => closer.close(cardKey, asked.ids)} onCancel={closer.cancel} />;
  }
  const buttons = actions.map((a) => (
    <button key={a.kind} type="button" className={CARD_BUTTON}
      aria-label={a.step.kind === "close" && name ? `${a.label} “${name}”` : undefined}
      onClick={() => (a.step.kind === "close" ? closer.ask(cardKey) : onAction(a))}>
      {ICON[a.kind]}{ICON[a.kind] ? " " : null}{a.label}
    </button>
  ));
  return className ? <div className={className}>{buttons}</div> : <>{buttons}</>;
}
