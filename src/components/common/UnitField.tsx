// src/components/common/UnitField.tsx
// A number field with its unit joined inside one box, "10s" (owner, 2026-11-06: the announcements' seconds were a box
// and a separate "s" beside it; rules: durations are joined). The field is the caller's (its value, its commit); the
// unit is drawn right after the digits, read aloud with the field's own name.
import type { ReactNode } from "react";

export default function UnitField({ unit, children }: {
  /** The unit, joined to the number ("s", "min", "days"). */
  unit: string;
  /** The <input>. */
  children: ReactNode;
}) {
  return (
    <span className="unit-field">
      {children}
      <span className="unit-field-unit" aria-hidden>{unit}</span>
    </span>
  );
}
