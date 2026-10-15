// src/components/common/CheckField.tsx
// A checkbox with its description after it — ONE look wherever the app has one (owner, 2026-10-15: "the description
// appears too close to the check box … the same style consistently applied wherever"). The two in Advanced Settings
// each set their own inline gap, and one read as glued to its box. The box, the space and the words are .check-field's
// (04-modals.css); a caller says only what it is and what it changes.

import type { ReactNode } from "react";

export default function CheckField({ checked, onChange, title, children }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The longer explanation, on hover. */
  title?: string;
  /** The description after the box. */
  children: ReactNode;
}) {
  return (
    <label className="check-field" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
