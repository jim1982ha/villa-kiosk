// src/hooks/useBackToClose.ts
// Make Android's BACK button dismiss the surface on top instead of leaving the
// app.
//
// ── Why this has to exist ────────────────────────────────────────────────
// This app is a single page with no routes, so until 2.326.0 nothing anywhere
// touched history at all — and a phone's back button therefore did the only
// thing left to it: exit the PWA. Reported against the camera feed, where it
// is at its worst (a full-screen video with the villa nowhere in sight is
// exactly when back means "get me out of this", and instead it closed VESTA),
// but the gap is general.
//
// ── Why a stack, and not an id comparison ────────────────────────────────
// Every mounted overlay hears `popstate`, so something has to decide which one
// the press was for. Matching `history.state` against an id sounds simpler and
// is not: after a pop, `history.state` is the entry BENEATH the one that went
// away, so each instance would be reasoning about a value that says nothing
// about whether it personally was popped. A module-level stack answers the
// real question directly — the press dismisses whatever is on top — and it
// nests correctly for free, because a surface opened over another is pushed
// over it here too.
//
// ── The half that is easy to forget ──────────────────────────────────────
// Closing by any OTHER route (Escape, the X button, picking something) must
// also spend the history entry this pushed, or it outlives the surface and the
// next back press appears to do nothing at all. That is what `unwinding`
// exists for: the cleanup calls `history.back()` itself, and the resulting
// popstate has to be swallowed rather than treated as a fresh press, which
// would otherwise dismiss the surface underneath as well.

import { useEffect, useRef } from "react";

interface Entry {
  close: () => void;
  /** The browser already popped this entry — cleanup must not spend it again. */
  popped: boolean;
}

const stack: Entry[] = [];
/** Programmatic `history.back()` calls whose `popstate` must be ignored. */
let unwinding = 0;
let listening = false;

function onPopState(): void {
  if (unwinding > 0) { unwinding -= 1; return; }
  const top = stack[stack.length - 1];
  if (!top) return;
  // Marked BEFORE closing: `close()` typically unmounts the component
  // synchronously enough that cleanup runs while this frame is still on the
  // stack, and cleanup must not then push a second `history.back()`.
  top.popped = true;
  top.close();
}

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
    if (!listening) {
      window.addEventListener("popstate", onPopState);
      listening = true;
    }
    const entry: Entry = { close: () => latest.current(), popped: false };
    stack.push(entry);
    // Same URL — this app is served under an add-on ingress path that must not
    // change, and there is no route here to reflect anyway. The entry exists
    // purely to give Back something to consume.
    history.pushState({ vkOverlay: true }, "");
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (entry.popped) return;
      // Closed by Escape, a button, or a state change — the entry is still in
      // history and has to go, or the next Back press is silently eaten.
      unwinding += 1;
      history.back();
    };
  }, [active]);
}
