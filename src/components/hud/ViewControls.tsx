// src/components/hud/ViewControls.tsx
// The first-person / bird's-eye view toggle — its own dedicated section in
// HUD's left column, right below the floor/rooms stack. Its former
// companion, the saved default-view "anchor" button, has moved onto the
// brand icon in the top bar (see HUD.tsx's .hud-brand + useHomeAnchor) —
// always visible there instead of only in overview mode, so "go home" no
// longer depends on which mode you're already in.

import { Map, PersonStanding } from "lucide-react";

export interface ViewControlsProps {
  viewMode: "first-person" | "overview";
  onToggleViewMode: () => void;
  /** Wrap the button in the shared .hud-stack section — the same glass block
   *  the floor toggle uses — so it reads as its own HUD section rather than a
   *  loose button. Always on at the current (left-column) call site. */
  stacked?: boolean;
}

export default function ViewControls({ viewMode, onToggleViewMode, stacked }: ViewControlsProps) {
  const overviewActive = viewMode === "overview";
  return (
    <div className={`overview-help-buttons${stacked ? " hud-stack" : ""}`}>
      {/* No `.active` (accent) styling — unlike the floor/rooms buttons above
          it, this is a plain mode SWITCH, not a lit "this is on" state
          indicator, so it stays neutral in both modes. */}
      <button
        className="icon-btn"
        onClick={onToggleViewMode}
        title={overviewActive ? "Switch to first-person view" : "Switch to overview (bird's-eye) view"}
        aria-label={overviewActive ? "Switch to first-person view" : "Switch to overview (bird's-eye) view"}
      >
        {overviewActive ? <PersonStanding size={19} /> : <Map size={18} />}
      </button>
    </div>
  );
}
