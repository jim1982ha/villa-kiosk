// src/hooks/useBackToClose.ts
// Make Android's BACK button dismiss the surface on top instead of leaving the
// app. The behaviour — the stack, the history reconciliation, why it is a
// stack and why history is reconciled rather than pushed inline — is
// hooks/backStack.ts; this is its React face and the app's one instance.

import { useEffect, useRef } from "react";
import { browserPort, createBackStack } from "./backStack";

const backStack = createBackStack(browserPort);

/**
 * Dismiss the surface on top — THE definition of "what does a dismiss gesture
 * dismiss", for every gesture that means it (Back, and Escape via useModalA11y).
 * @returns false when nothing is registered, so a caller can fall through.
 */
export const dismissTop = (): boolean => backStack.dismissTop();

/**
 * Is ANY surface open — a dialog, a panel, a sheet or a menu? The stack every
 * dismissable surface registers on answers it, so there is one list and not a
 * second, hand-kept one to fall behind (2.496.192).
 */
export const overlayOpen = (): boolean => backStack.overlayOpen();

/**
 * Swallow one back press to close this surface.
 *
 * Add it to any overlay that should be dismissed by Back rather than have Back
 * leave the app — one line, no markup, no coordination with anything else on
 * screen.
 *
 * `onClose` is called THROUGH a ref, deliberately. Registering it as an effect
 * dependency would push a history entry every time the handler's identity
 * changed — a back press per render — while capturing it once would leave the
 * surface closing through a handler from its first render. The indirection is
 * what lets the registration happen exactly once and still run current code.
 *
 * @param active  Pass false to register nothing (a surface that is mounted but
 *                not currently the thing Back should dismiss).
 */
export function useBackToClose(onClose: () => void, active = true): void {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!active) return;
    return backStack.register(() => latest.current());
  }, [active]);
}

