// src/components/settings/CardField.tsx
// ONE field of a Settings card (owner, 2026-11-06: the bound cards "more like" a device's, its name then its field on
// one line, "That would homogenise the cards"): its name in the cards' one name column (.card-field, --card-field-label),
// its control the rest of the card's width; on a phone the name above it. Every card's field draws this, never its own row.

import type { ReactNode } from "react";

export default function CardField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="card-field"><span className="eyebrow card-field-label">{label}</span>{children}</div>;
}
