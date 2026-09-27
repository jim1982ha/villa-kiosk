// src/hooks/useOutsideClose.ts
// A non-modal POPOVER closes on a pointerdown outside it and on Escape —
// ONE hook for the four that hand-wrote it (summary tile menu, HUD ⋯ menu,
// the two device search pickers; two used mousedown, so a touch outside them
// did not close them until the synthesized click) (2.496.199).
//
// ⚠️ DELIBERATELY NOT useModalA11y. That hook is the MODAL contract — focus
// trap, Escape, focus restore, back-to-close — and a popover is not modal:
// anchored to its trigger, no backdrop, no role="dialog". Trapping focus in a
// thing that covers nothing is a defect (a keyboard user could not Tab out).
// Escape and outside-tap are the whole contract here.

import { useEffect, type RefObject } from "react";

export function useOutsideClose(
  /** Everything that counts as INSIDE: the popover and the trigger that
   *  opened it (a tap on the trigger must not close-then-reopen). */
  inside: readonly RefObject<Element | null>[],
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (inside.some((r) => r.current?.contains(t))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // `inside` is a fresh array literal at every call site; its refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}
