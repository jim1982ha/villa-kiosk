// src/hooks/useLongPress.ts
// Press-and-hold on a DOM element, as reusable props.
//
// The HUD already hand-rolls this twice (category icons, floor buttons) with
// its own timers and its own idea of how far a finger may drift. This exists so
// the next place that needs it — starting with the superadmin delete gate on
// Facility rows — does not become a third copy with slightly different
// behaviour. Those two are worth migrating onto this, but that is a change to
// working gesture code and belongs in its own pass, not smuggled into a
// feature.
//
// Deliberate details:
//   * pointer events, so one path covers touch, mouse and pen;
//   * a movement threshold, so SCROLLING a list never fires the action — on a
//     phone the whole Facility screen is a scroller, and a long-press that
//     triggers mid-flick would be worse than no gesture at all;
//   * cancel on pointercancel/leave, which is what the browser sends when it
//     decides the gesture became a scroll;
//   * keyboard parity via Enter/Space held down, so the capability is not
//     mouse-and-finger only.

import { useCallback, useRef } from "react";

const LONG_PRESS_MS = 600;
/** Pixels of drift tolerated before the press is treated as a scroll/drag. */
const MOVE_TOLERANCE_PX = 10;

export interface LongPressHandlers {
  /** Swallows the click the browser fires after a completed hold. Without it
   *  a row that is BOTH tappable (open it) and holdable (erase it) would run
   *  its tap action the moment the hold's own dialog appeared. Call this
   *  first in your own onClick and bail if it returns true. */
  consumeClick: () => boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onKeyUp: () => void;
}

/** @param onLongPress fired once, when the hold completes. */
export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  /** Set when a hold completes, cleared by the click that follows it. */
  const justFired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  const start = useCallback((x: number, y: number) => {
    cancel();
    origin.current = { x, y };
    timer.current = setTimeout(() => {
      timer.current = null;
      origin.current = null;
      justFired.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }, [cancel, onLongPress]);

  return {
    consumeClick: () => {
      if (!justFired.current) return false;
      justFired.current = false;
      return true;
    },
    onPointerDown: (e) => start(e.clientX, e.clientY),
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onPointerMove: (e) => {
      const from = origin.current;
      if (!from) return;
      if (Math.abs(e.clientX - from.x) > MOVE_TOLERANCE_PX
        || Math.abs(e.clientY - from.y) > MOVE_TOLERANCE_PX) cancel();
    },
    // Holding Enter/Space auto-repeats, so ignore the repeats and let the
    // first press start the same timer a finger would.
    onKeyDown: (e) => {
      if (e.repeat || (e.key !== "Enter" && e.key !== " ")) return;
      start(0, 0);
    },
    onKeyUp: cancel,
  };
}
