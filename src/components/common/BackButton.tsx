// src/components/common/BackButton.tsx
//
// "Back": a window opened from another one returns there. Top right of the window's header, or bottom left of its
// footer where the window it returns to has its opener (Advanced Settings; owner, 2026-10-24).
//
// ⚠️ ONE BACK FOR EVERY WINDOW (owner, 2026-10-24: Advanced Settings "show the same Back button … consistent with
// other modals"): the device windows drew it by hand in BasePanel; Advanced Settings had a Close in its footer instead.
// ⚠️ ONE LOOK TOO (owner, 2026-11-10: "only 1 definition for all similar UI elements"): the header's was a smaller
// pill of its own (.panel-back), the footer's the worded button, a data window's History a bare chevron in the
// icon's tile. All three are the worded button (.btn), its word hidden on a phone or where there is no room for it.

import { ChevronLeft } from "lucide-react";
import Tip from "./Tip";

/** `label`: where it returns ("Back to Settings" as its name and tip); none, just "Back". `wordless`: the chevron
 *  alone at every width (a data window's History, where the header's right side is the period's choice). */
export default function BackButton({ onClick, label, wordless = false }: { onClick: () => void; label?: string; wordless?: boolean }) {
  const name = label ? `Back to ${label}` : "Back";
  return (
    <Tip text={name}>
      <button type="button" className={`btn${wordless ? " icon-only" : ""}`} onClick={onClick} aria-label={name}>
        <ChevronLeft size={18} aria-hidden />{!wordless && <span className="btn-label">Back</span>}
      </button>
    </Tip>
  );
}
