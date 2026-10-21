// src/hooks/useArrowStep.ts
// Left / Right arrow keys step through a set — the next camera, the next photo. Written out by the camera window
// (with its guards) and the photo viewer (without them, so an arrow typed in a field behind it also turned the photo)
// until 2026-10-22. The LATEST onStep runs, so a caller's moving closure never re-registers the listener.

import { useEffect, useRef } from "react";

export function useArrowStep(onStep: (delta: -1 | 1) => void, enabled = true): void {
  const latest = useRef(onStep);
  latest.current = onStep;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // A modifier means the browser's own navigation, and a caret in a field
      // means the user is editing text, not driving the panel.
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && (el.isContentEditable
        || el instanceof HTMLInputElement
        || el instanceof HTMLTextAreaElement
        || el instanceof HTMLSelectElement)) return;
      e.preventDefault();
      latest.current(e.key === "ArrowRight" ? 1 : -1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
