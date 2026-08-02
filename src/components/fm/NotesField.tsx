// src/components/fm/NotesField.tsx
// The free-text field every Facility record needs, defined once.
//
// Each form had grown its own idea of "notes": the fault form had none at all
// (a one-line summary was the only place to put anything, so a fault could be
// named but never explained), logging a completion used a single-line <input>
// that scrolled sideways past about eight words, and the two dialogs that did
// use a textarea disagreed on its height. The result was that how much you
// could say about a piece of work depended on which screen you happened to be
// on — which is not a decision any of those screens should be making.
//
// So: one component. It also grows with its content up to a limit, because a
// fixed three rows is wrong in both directions — too tall for "replaced the
// filter", too short for a real account of what went wrong.

import { useLayoutEffect, useRef } from "react";

const MIN_ROWS = 2;
const MAX_PX = 220;

export default function NotesField({
  label, value, onChange, placeholder, rows = MIN_ROWS,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Starting height. It grows from here as the text does. */
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow. Reset to "auto" first so the box can also SHRINK when text is
  // deleted — measuring scrollHeight against the current height only ever
  // ratchets upward. Capped, then allowed to scroll: an unbounded textarea
  // pushes the form's buttons off the bottom of a phone screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_PX)}px`;
  }, [value]);

  return (
    <label className="fm-field">
      <span>{label}</span>
      <textarea
        ref={ref}
        className="fm-notes"
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
