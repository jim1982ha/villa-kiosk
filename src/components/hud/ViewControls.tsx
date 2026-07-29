// src/components/hud/ViewControls.tsx
// The first-person / bird's-eye view toggle — its own dedicated section in
// HUD's left column, right below the floor/rooms stack (previously a lone
// standalone button pinned to the bottom-left corner, with nothing to
// explain it and no protection from the SummaryBar's tile row visually
// extending over that corner on a narrow phone). Its companion, the saved
// default-view "anchor" button, is DefaultViewButton below — a separate
// export so HUD can embed it inline in the left-column floor/rooms stack (as
// its 4th button) instead of pairing it with the toggle here; the two used
// to be one component sharing a wrapper, but the anchor's home moved and the
// toggle no longer needs to know about it.

import { useRef, useState } from "react";
import { Map, PersonStanding, Anchor } from "lucide-react";

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
      {/* No `.active` (accent) styling — unlike the floor/rooms/anchor
          buttons above it, this is a plain mode SWITCH, not a lit "this is
          on" state indicator, so it stays neutral in both modes. */}
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

export interface DefaultViewButtonProps {
  /** Whether THIS device has a saved default framing (button's lit state). */
  hasOverviewDefault: boolean;
  /** Tap: jump to the saved default. Returns false when there isn't one. */
  onApplyOverviewDefault: () => boolean;
  /** Long-press / right-click: save the current framing as the default. */
  onSaveOverviewDefault: () => void;
}

const HOLD_MS = 480;
const FLASH_MS = 1800;

/** The saved default-view "anchor" — tap to jump to this device's default
 *  framing, long-press / right-click to (re)define it. Lives in HUD's
 *  left-column floor/rooms stack (as its 4th button, overview mode only) —
 *  a bare <button> (plus its own confirmation flash), not wrapped in any
 *  section chrome of its own, since it's meant to sit INSIDE an existing
 *  .hud-stack alongside the floor/rooms buttons rather than form a section
 *  by itself. */
export function DefaultViewButton({
  hasOverviewDefault, onApplyOverviewDefault, onSaveOverviewDefault,
}: DefaultViewButtonProps) {
  // Tap = jump to this device's saved default view; long-press / right-click
  // = (re)define it as the current framing (same tap-vs-hold convention as
  // the Rooms menu's re-anchor gesture and the in-scene badge gestures). A
  // brief confirmation line appears for ~1.8s either way.
  const [flash, setFlash] = useState<"applied" | "none" | "saved" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  const flashView = (kind: "applied" | "none" | "saved") => {
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  const onDown = () => {
    longFired.current = false;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      onSaveOverviewDefault();
      flashView("saved");
    }, HOLD_MS);
  };
  const onClick = () => {
    cancelPress();
    if (longFired.current) { longFired.current = false; return; }
    flashView(onApplyOverviewDefault() ? "applied" : "none");
  };

  return (
    <>
      {flash && (
        <div className="overview-hint hud-anchor-hint">
          {flash === "applied"
            ? "Jumped to this device's default view."
            : flash === "saved"
              ? "Default view updated for this device — it'll open here every reload."
              : "No default view saved yet — long-press (or right-click) to set one."}
        </div>
      )}
      <button
        className={`icon-btn has-hold-action${hasOverviewDefault ? " active" : ""}`}
        onPointerDown={onDown}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onSaveOverviewDefault();
          flashView("saved");
        }}
        // Space-only (not Enter): a <button> fires its click on Enter's
        // KEYDOWN but on Space's KEYUP, so only Space can time a real
        // "hold" — arming this on Enter too would fire the tap AND,
        // ~480ms later while still held, spuriously ALSO fire save.
        // Enter needs no extra handling: its native click already
        // reaches onClick above, same as a plain tap.
        onKeyDown={(e) => { if (e.key === " " && !e.repeat) onDown(); }}
        onKeyUp={(e) => { if (e.key === " ") cancelPress(); }}
        title="Tap to go to this device's default view · long-press / right-click to set it to the current view"
        aria-label="Go to this device's default overview view"
        aria-describedby="anchor-btn-hint"
        aria-pressed={hasOverviewDefault}
      >
        <Anchor size={18} />
      </button>
      <span id="anchor-btn-hint" className="sr-only">Hold Space to save the current view as the default</span>
    </>
  );
}
