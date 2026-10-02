// src/components/hud/ViewControls.tsx
// The first-person / bird's-eye view toggle. On a roomy screen it is the last
// button of the left column's floor section, under 1F/2F (owner, 2.496.248 —
// it had moved to the top bar's right-hand icons); a phone carries its own
// row in the overflow menu instead (HUD.tsx, .hud-menu), and hides this one
// with the rest of the inline controls (05-layout.css, .hud-view-btn).

import { Map, PersonStanding } from "lucide-react";

export interface ViewControlsProps {
  viewMode: "first-person" | "overview";
  onToggleViewMode: () => void;
  /** Extra classes for the button — its place in the HUD. */
  className: string;
}

export default function ViewControls({ viewMode, onToggleViewMode, className }: ViewControlsProps) {
  const overviewActive = viewMode === "overview";
  // No `.active` (accent) styling — unlike the floor buttons above it, this is
  // a plain mode SWITCH, not a lit "this is on" state, so it stays neutral in
  // both modes.
  return (
    <button
      className={`icon-btn ${className}`}
      onClick={onToggleViewMode}
      title={overviewActive ? "Switch to first-person view" : "Switch to overview (bird's-eye) view"}
      aria-label={overviewActive ? "Switch to first-person view" : "Switch to overview (bird's-eye) view"}
    >
      {overviewActive ? <PersonStanding size={19} /> : <Map size={18} />}
    </button>
  );
}
