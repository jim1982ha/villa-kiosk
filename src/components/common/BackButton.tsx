// src/components/common/BackButton.tsx
//
// "Back": a window opened from another one returns there. Top right of the window's header, a quiet pill, so it
// reads as navigation, not as the window's primary action (style: .panel-back).
//
// ⚠️ ONE BACK FOR EVERY WINDOW (owner, 2026-10-24: Advanced Settings "show the same Back button … consistent with
// other modals"): the device windows drew it by hand in BasePanel; Advanced Settings had a Close in its footer instead.

import { ChevronLeft } from "lucide-react";

/** `label`: where it returns ("Back to Settings" as its name and tooltip); none, just "Back". */
export default function BackButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const name = label ? `Back to ${label}` : "Back";
  return (
    <button type="button" className="btn panel-back" onClick={onClick} title={name} aria-label={name}>
      <ChevronLeft size={18} aria-hidden /> Back
    </button>
  );
}
