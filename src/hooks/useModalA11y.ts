// src/hooks/useModalA11y.ts
// The keyboard/assistive-tech contract every dialog in this app owes, in one
// hook: focus goes INTO the dialog when it opens, stays inside while it's
// open, and returns to whatever opened it on close.
//
// Before this, ten surfaces shared the .modal-backdrop shell and none of them
// did any of that. The practical failure on this app specifically: behind
// every dialog sits a full-screen Babylon <canvas> plus the whole HUD, so a
// Tab out of an open dialog didn't land somewhere harmless — it walked into
// the live villa controls underneath, still visually covered by the scrim.
// The user could then "click" a light they couldn't see. Escape handling was
// already right everywhere; this is the rest of the contract.
//
// Deliberately a hook over a <Modal> wrapper component: the dialogs here have
// genuinely different shells (device panel, settings sheet, lightbox, pin
// pad) and several are mid-refactor-averse — a hook adds the behaviour to
// each without forcing one markup shape onto all of them.

import { useEffect, useRef } from "react";

/** Everything focusable we might need to reach inside a dialog. `:not([inert])`
 *  and the negative-tabindex exclusion keep out things that are present but
 *  deliberately unreachable. */
const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    // offsetParent is null for display:none subtrees — a hidden tab's fields
    // must not be in the tab ring even though they're in the DOM.
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * @param onClose  Called on Escape. Passing it here means a dialog gets
 *                 Escape + focus handling from ONE hook rather than wiring
 *                 its own keydown listener alongside this (which is how the
 *                 app ended up with 13 separate Escape handlers).
 * @returns  A ref to put on the dialog's outermost element.
 */
export function useModalA11y(onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Whatever had focus before this opened — restored on close so a keyboard
    // user lands back on the control they activated, not at the top of the
    // document.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first meaningful control. Prefer an explicitly-marked one
    // (data-autofocus) so a dialog can nominate its primary field; otherwise
    // the first focusable; otherwise the container itself, which needs a
    // tabindex to be focusable at all.
    const preferred = node.querySelector<HTMLElement>("[data-autofocus]");
    const first = preferred ?? focusableWithin(node)[0];
    if (first) {
      first.focus();
    } else {
      node.setAttribute("tabindex", "-1");
      node.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableWithin(node);
      if (items.length === 0) {
        // Nothing to cycle through — keep focus on the dialog rather than
        // letting Tab escape to the villa behind it.
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Wrap at both ends. Also catches the case where focus somehow sits
      // outside the dialog entirely (a programmatic focus elsewhere): pull it
      // back to the appropriate edge instead of letting Tab continue out.
      if (e.shiftKey && (active === firstItem || !node.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !node.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    // Capture phase: a dialog nested inside another (the badge colour picker
    // over a device panel) must handle its own Tab/Escape before the parent's
    // listener sees it.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Only restore if the element is still around and focusable — a dialog
      // opened from a row that has since re-rendered away would otherwise
      // throw or focus a detached node.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [onClose]);

  return ref;
}
