// src/components/common/ToggleField.tsx
//
// A switch and the sentence explaining it, in that reading order.
//
// ⚠️ THE EXPLANATION COMES FIRST, WHICH IS THE SAME RULE `.fm-field` NOW
// FOLLOWS. A text field reads explanation → name → control; a toggle carries
// its name ON the control, so it reads explanation → control. Either way the
// sentence that tells you what a thing does arrives before the thing, and a
// reader deciding whether to flip a switch has the consequence in front of them
// rather than underneath.
//
// ⚠️ A COMPONENT RATHER THAN EIGHT MARKUP SWAPS. The pattern is a `label.toggle`
// followed by a sibling paragraph, repeated across the settings surfaces — and
// swapping each by hand leaves the next one written in the old order, which is
// exactly how the field notes ended up in two orders at once. The rule is
// enforceable only if there is one place that renders it.
//
// ⚠️ THE PARAGRAPH IS A SIBLING OF THE LABEL, NOT INSIDE IT. Putting explanatory
// text inside `label.toggle` makes every word of it part of the checkbox's click
// target — so a reader tapping to read a two-line caveat on a wall tablet
// silently flips the setting it is warning them about.

import type { ReactNode } from "react";
import InfoHint from "./InfoHint";

export default function ToggleField({
  checked, onChange, label, note, more, disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The switch's own name — short, and it rides the control. */
  label: string;
  /** What happens if you flip it, in AT MOST TWO LINES. Rendered above the
   *  switch. ⚠️ Anything longer belongs in `more` — a settings pane where every
   *  control carries a paragraph is one nobody reads. */
  note: ReactNode;
  /** The rest of the explanation, behind an inline (i). Optional: a control
   *  whose two lines say everything needs no bubble, and an empty one would be
   *  a button that rewards a tap with nothing. */
  more?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="toggle-field">
      <p className="muted body-text">
        {note}
        {more ? <InfoHint label={label}>{more}</InfoHint> : null}
      </p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
    </div>
  );
}
