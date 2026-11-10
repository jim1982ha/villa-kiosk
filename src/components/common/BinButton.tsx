// src/components/common/BinButton.tsx
// A card's bin: the round icon button, its name for a screen reader, what it does in the app's own tip (common/Tip).
//
// ⚠️ WRITTEN OUT THREE TIMES (UI scan, 2026-11-10): a task's on the Today and Schedule tabs and a saved document's,
// each its own Tip around its own icon button.

import { Trash2 } from "lucide-react";
import Tip from "./Tip";

export default function BinButton({ label, tip = label, onPress }: {
  /** Its name, with what it removes ("Remove Generator service"). */
  label: string;
  /** What pressing it does and keeps, when the name alone does not say. */
  tip?: string;
  onPress: () => void;
}) {
  return (
    <Tip text={tip}>
      <button type="button" className="icon-btn" onClick={onPress} aria-label={label}>
        <Trash2 size={16} aria-hidden />
      </button>
    </Tip>
  );
}
