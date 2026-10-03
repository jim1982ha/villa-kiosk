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
// The hold is the shared useLongPress (2.496.263) in its NATIVE-BUTTON mode:
// this is a real <button>, whose click fires on ENTER'S KEYDOWN, so only
// Space's keyup can time a genuine hold — `nativeButton` arms the keyboard
// hold on Space only, which is exactly the finding this file used to hand-roll
// a second timer (and a copy of the HUD hold time) for. Its drift tolerance
// also means a finger that slides off no longer saves by accident.

import { useRef, useState } from "react";
import { useLongPress, HOLD_MS_HUD } from "@/hooks/useLongPress";

const FLASH_MS = 1800;

export type HomeAnchorFlash = "applied" | "none" | "saved" | "unavailable";

export interface HomeAnchorButtonProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onKeyUp: () => void;
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

  const flashView = (kind: HomeAnchorFlash) => {
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };
  const doSave = () => flashView(onSave() ? "saved" : "unavailable");
  const { consumeClick, ...hold } = useLongPress(doSave, { holdMs: HOLD_MS_HUD, nativeButton: true });

  const buttonProps: HomeAnchorButtonProps = {
    ...hold,
    onClick: () => {
      // The click a completed hold leaves behind is the hold's, not a tap.
      if (consumeClick()) return;
      flashView(onApply() ? "applied" : "none");
    },
    onContextMenu: (e) => { e.preventDefault(); doSave(); },
  };

  return { flash, buttonProps };
}
