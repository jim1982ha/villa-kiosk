// src/components/common/IconButton.tsx
// THE lone icon button of a window, a card, a field, a pill and a notice (.icon-quiet, 01-base.css): the icon alone,
// its name for a screen reader, the same name in the app's own tip (common/Tip) under a mouse.
//
// ⚠️ IT WAS EIGHT RULES (owner, 2026-11-10: "only 1 definition for all similar UI elements"): a card's remove, a
// pill's ✕, a notice's and a footer note's ✕, a field's clear, the (i), a chart's enlarge and Listen each drew their
// own, a black plate here, a ring there, 18 to 32 px, half of them named by the browser's grey `title`. Over the map
// the button is the plate (.icon-btn); over a photo or a video, .media-btn; a worded button without its word,
// .btn.icon-only.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import Tip from "./Tip";

export default function IconButton({ label, tip = label, small = false, danger = false, className, children, ...rest }: {
  /** Its name, with what it acts on ("Remove Generator service"). */
  label: string;
  /** What a mouse over it reads: its name unless said; null for one that opens a card of its own (the (i)). */
  tip?: string | null;
  /** Beside words: a title, a pill, a field, a notice's line. */
  small?: boolean;
  /** It removes: red under the mouse. */
  danger?: boolean;
  /** Where it sits (a place's own class), never how it looks. */
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label" | "className" | "children">) {
  return (
    <Tip text={tip}>
      <button type="button" className={`icon-quiet${small ? " small" : ""}${className ? ` ${className}` : ""}${danger ? " danger" : ""}`}
        aria-label={label} {...rest}>
        {children}
      </button>
    </Tip>
  );
}
