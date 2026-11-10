// src/components/common/Answers.tsx
// The two answers a question, a form or a window with a Save ends in: Cancel, then the answer itself, last, where
// every window's main button is.
//
// ⚠️ WRITTEN OUT SIX TIMES (owner, 2026-11-10: "only 1 definition for all similar UI elements"): Settings' footer
// (pills, a glyph and a word each), a form window's footer (pills, words alone), the question box (its own footer),
// a Cockpit form's end (outlined boxes, glyphs), a question in place (outlined boxes, no glyph) and Advanced Settings'
// tools. Each chose its own glyphs, its own Cancel and whether a second press could send twice. Here once: Cancel is
// the ✕ and its word (the ✕ alone on a phone), the answer its glyph and its word, in the accent, or in red when it
// cannot be taken back. A card's question keeps its bar (fm/RecordCard CardAsk): the main action first, as on
// every card.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import Tip from "./Tip";

export interface Answer {
  /** Its word: what a press does ("Save task", "Unlock", "Send report"). */
  label: ReactNode;
  /** Its glyph, before its word: a check unless the answer has its own (Save's). */
  icon?: ReactNode;
  /** ⚠️ ONE PRESS AT A TIME (UI scan, 2026-11-10: a second press on a form's Save sent the record twice): a press
   *  that returns a promise greys the button, saying `busy`, until it settles. */
  onPress: () => unknown;
  disabled?: boolean;
  /** Its word while its press is on its way ("Saving…"). */
  busy?: ReactNode;
  /** It cannot be taken back: red. */
  danger?: boolean;
  /** Its glyph says it alone (Save): its word hides on a phone, as Cancel's does. */
  terse?: boolean;
  /** Its name for a screen reader, when its word is not it ("Nothing to save"). */
  name?: string;
  /** What a press leads to (common/Tip). */
  tip?: string;
}

export default function Answers({ answer, onCancel, cancelLabel = "Cancel", cancelTip, extra }: {
  answer: Answer;
  /** None: a box that only tells (the question box's "OK"). */
  onCancel?: () => void;
  /** Its word, where "Cancel" would not say what is kept (a question that discards: "Keep"). */
  cancelLabel?: string;
  cancelTip?: string;
  /** A form's own button, on the left of Cancel (Spend settings' "Remove cap"). */
  extra?: ReactNode;
}) {
  const [sending, setSending] = useState(false);
  const shown = useRef(true);
  useEffect(() => { shown.current = true; return () => { shown.current = false; }; }, []);
  const press = () => {
    if (sending) return;
    const sent = answer.onPress();
    if (!(sent instanceof Promise)) return;
    setSending(true);
    // what closed on its answer is gone by now: nothing left to un-grey
    void sent.finally(() => { if (shown.current) setSending(false); });
  };
  return (
    <>
      {extra}
      {onCancel && (
        <Tip text={cancelTip}>
          <button type="button" className="btn" aria-label={cancelLabel} onClick={onCancel}>
            <X size={18} aria-hidden /><span className="btn-label">{cancelLabel}</span>
          </button>
        </Tip>
      )}
      <Tip text={answer.tip}>
        <button type="button" className={`btn ${answer.danger ? "danger" : "primary"}`} disabled={answer.disabled || sending}
          aria-label={answer.name} onClick={press}>
          {answer.icon ?? <Check size={18} aria-hidden />}
          <span className={answer.terse ? "btn-label" : undefined}>{sending && answer.busy ? answer.busy : answer.label}</span>
        </button>
      </Tip>
    </>
  );
}
