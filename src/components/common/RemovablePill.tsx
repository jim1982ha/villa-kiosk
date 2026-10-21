// src/components/common/RemovablePill.tsx
// A pill that names something on a list, with its own ✕ to take it off (a device group's members, the devices asleep
// by design): the Kiosk's one pill (.fm-entity-chip, the Cockpit's), not a box of its own.
//
// ⚠️ IT WAS COPIED (owner, 2026-10-22: "wherever there is a card or pill, the same style, centralised"): Settings'
// device groups and its "Unavailable by design" list each drew this pill in inline styles of their own.

import { X } from "lucide-react";
import Tip from "./Tip";

export default function RemovablePill({ label, tip, removeLabel, onRemove }: {
  label: string;
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
        <Tip text={removeLabel}>
          <button type="button" className="fm-chip-remove" aria-label={removeLabel} onClick={onRemove}>
            <X size={12} aria-hidden="true" />
          </button>
        </Tip>
      </span>
    </Tip>
  );
}
