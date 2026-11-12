// src/components/common/RemovablePill.tsx
// A pill that names something on a list, with its own ✕ to take it off (a device group's members, the devices asleep
// by design): the Kiosk's one pill (.fm-entity-chip, the Cockpit's), not a box of its own.
//
// ⚠️ IT WAS COPIED (owner, 2026-10-22: "wherever there is a card or pill, the same style, centralised"): Settings'
// device groups and its "Unavailable by design" list each drew this pill in inline styles of their own.

import type { ReactNode } from "react";
import { X } from "lucide-react";
import IconButton from "./IconButton";
import Tip from "./Tip";

export default function RemovablePill({ label, tip, removeLabel, onRemove }: {
  label: ReactNode;
  /** What hovering the pill says (its entity id). */
  tip?: string;
  /** The ✕'s words: its tooltip and its accessible name. */
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <Tip text={tip}>
      <span className="fm-entity-chip fm-chip-static fm-chip-removable">
        {label}
        <IconButton small label={removeLabel} onClick={onRemove}><X size={14} aria-hidden="true" /></IconButton>
      </span>
    </Tip>
  );
}
