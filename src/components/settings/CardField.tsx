// src/components/settings/CardField.tsx
// ONE field of a Settings card (owner, 2026-11-06: the bound cards "more like" a device's, its name then its field on
// one line, "That would homogenise the cards"): its name in the cards' one name column (.card-field, --card-field-label),
// its control the rest of the card's width; on a phone the name above it. Every card's field draws this, never its own row.
//
// ⚠️ WHAT A FIELD IS FOR IS ITS NAME'S (i) (`tip`; UI scan, 2026-11-11): a device card's fields said it on hover only,
// each its own way (a title, a tip on the box), which a finger never sees. The (i) is the one every setting's name has.

import type { ReactNode } from "react";
import InfoTip from "@/components/common/InfoTip";

export default function CardField({ label, tip, children }: {
  label: string;
  /** The name's (i): what the field does. */
  tip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card-field">
      <span className={`eyebrow card-field-label${tip ? " with-tip" : ""}`}>
        {label}{tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}
      </span>
      {children}
    </div>
  );
}
