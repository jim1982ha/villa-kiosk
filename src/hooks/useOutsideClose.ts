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
// Escape, Back and outside-tap are the whole contract here.
//
// ⚠️ EVERY POPOVER IS ON THE ONE LIST OF WHAT IS OPEN (UI scan, 2026-11-10). A
// device search list, an (i) and an "add" line were not: with one open in
// Settings, Escape or a phone's Back asked the list for what is on top, got the
// window, and cancelled every change on every tab to close a small box. The
// hook registers the popover itself (useBackToClose), so the first Escape or
// Back closes only it; the menus that registered by hand no longer do.

import { useEffect, useRef, type RefObject } from "react";
import { useBackToClose } from "./useBackToClose";

export function useOutsideClose(
  /** Everything that counts as INSIDE: the popover and the trigger that
   *  opened it (a tap on the trigger must not close-then-reopen). */
  inside: readonly RefObject<Element | null>[],
  open: boolean,
  onClose: () => void,
  /** What Escape and Back run, when it is not the outside tap's (a list that gives the focus back to its button). */
  onDismiss: () => void = onClose,
): void {
  useBackToClose(onDismiss, open);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (inside.some((r) => r.current?.contains(t))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss.current(); };
    // ⚠️ BEFORE ANYTHING (capture), so a press that something stops on its way up still closes it (2.496.719): a
    // card's bar, or a card's source icon opening its own tip, stop the press from reaching the card under them
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    // `inside` is a fresh array literal at every call site; its refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}
