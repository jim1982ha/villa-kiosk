// src/components/hud/useHomeAnchor.ts
// Interaction + confirmation-flash state behind the brand icon's "go home"
// gesture — tap jumps to this device's saved default overview framing (see
// HUD.tsx's .hud-brand); long-press or right-click (re)defines it as the
// current overview framing. Used to live on its own "anchor" button in the
// left-column floor stack (overview mode only) — moved onto the always-
// visible brand icon so returning home doesn't depend on which mode you're
// already in. A hook, not inline JSX state, because the confirmation flash
// has to render OUTSIDE .hud-brand (which clips overflow to stop a long
// villa name from wrapping) while the button itself renders INSIDE it.
//
// Deliberately hand-rolled rather than the shared useLongPress hook: this is
// a real <button>, and a native button fires its click on ENTER'S KEYDOWN —
// arming useLongPress's hold timer on Enter too would then, ~480ms later
// while the key is still down, ALSO fire the hold action right after the tap
// already fired. Only Space's keyup can time a genuine "hold" on a native
// button. useLongPress's own consumers so far are role="button" divs, which
// don't get a native click on Enter at all, so the hook is correct there and
// wrong here.

import { useRef, useState } from "react";

const HOLD_MS = 480;
const FLASH_MS = 1800;

export type HomeAnchorFlash = "applied" | "none" | "saved" | "unavailable";

export interface HomeAnchorButtonProps {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onKeyUp: (e: React.KeyboardEvent) => void;
}

/**
 * @param onApply Tap: jump to the saved default (switching into overview
 *   first if needed). Returns false when there isn't one saved.
 * @param onSave Long-press / right-click: save the current overview framing
 *   as the default. Returns false when not currently in overview (nothing to
 *   capture) — same guard SceneManager.saveOverviewDefault enforces.
 */
export function useHomeAnchor(onApply: () => boolean, onSave: () => boolean) {
  const [flash, setFlash] = useState<HomeAnchorFlash | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  const flashView = (kind: HomeAnchorFlash) => {
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };
  const doSave = () => flashView(onSave() ? "saved" : "unavailable");
  const onDown = () => {
    longFired.current = false;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longFired.current = true;
      doSave();
    }, HOLD_MS);
  };

  const buttonProps: HomeAnchorButtonProps = {
    onPointerDown: onDown,
    onPointerUp: cancelPress,
    onPointerLeave: cancelPress,
    onPointerCancel: cancelPress,
    onClick: () => {
      cancelPress();
      if (longFired.current) { longFired.current = false; return; }
      flashView(onApply() ? "applied" : "none");
    },
    onContextMenu: (e) => { e.preventDefault(); doSave(); },
    // Space-only (not Enter) — see the file header for why.
    onKeyDown: (e) => { if (e.key === " " && !e.repeat) onDown(); },
    onKeyUp: (e) => { if (e.key === " ") cancelPress(); },
  };

  return { flash, buttonProps };
}
