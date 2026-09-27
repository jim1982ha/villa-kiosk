// src/components/common/SegmentedGroup.tsx
// THE `.segmented` button group: one control, one markup, one accessibility
// contract (role="group", aria-pressed on each option). useSegmentedChoice
// (historyRange) rendered it and six more sites in the Cockpit and Settings
// hand-rolled the same markup (2.496.199). A single toggle is a one-option
// group whose `active` is null while off.

import type { ReactNode } from "react";

export interface SegmentedOption<K extends string> {
  key: K;
  /** What the button shows — text, an icon, or both. */
  label: ReactNode;
  /** Tooltip, and the accessible name when the label is an icon alone. */
  title?: string;
}

export default function SegmentedGroup<K extends string>({
  options, active, onChange, ariaLabel, className = "",
}: {
  options: readonly SegmentedOption<K>[];
  /** The pressed option, or null for none (a toggle that is off). */
  active: K | null;
  onChange: (key: K) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={`segmented${className ? ` ${className}` : ""}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.key} type="button" className={o.key === active ? "active" : ""}
          onClick={() => onChange(o.key)} aria-pressed={o.key === active} title={o.title} aria-label={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
