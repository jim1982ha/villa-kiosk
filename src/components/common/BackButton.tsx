// src/components/common/BackButton.tsx
//
// "Back": a window opened from another one returns there. Top right of the window's header, a quiet pill, so it
// reads as navigation, not as the window's primary action (style: .panel-back).
//
// ⚠️ ONE BACK FOR EVERY WINDOW (owner, 2026-10-24: Advanced Settings "show the same Back button … consistent with
// other modals"): the device windows drew it by hand in BasePanel; Advanced Settings had a Close in its footer instead.

import { ChevronLeft } from "lucide-react";

/** `label`: where it returns ("Back to Settings" as its name and tooltip); none, just "Back". `footer`: drawn as a
 *  footer button where the window it returns to has its opener (Advanced Settings: bottom left, where Settings' own
 *  "Advanced Settings" is; owner, 2026-10-24), its word hidden on a phone like every footer button's. */
export default function BackButton({ onClick, label, footer = false }: { onClick: () => void; label?: string; footer?: boolean }) {
  const name = label ? `Back to ${label}` : "Back";
  if (footer) {
    return (
      <button type="button" className="btn" onClick={onClick} title={name} aria-label={name}>
        <ChevronLeft size={18} aria-hidden /><span className="btn-label">Back</span>
      </button>
    );
  }
  return (
    <button type="button" className="btn panel-back" onClick={onClick} title={name} aria-label={name}>
      <ChevronLeft size={18} aria-hidden /> Back
    </button>
  );
}
