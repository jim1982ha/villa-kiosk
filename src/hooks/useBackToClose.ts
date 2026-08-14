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
// ── Why history is RECONCILED, not pushed and popped inline ──────────────
// Because surfaces SWAP, not just nest, and until 2.332.0 only nesting was in
// the model. "Advanced Settings" closes Settings and opens itself in one React
// commit, so one cleanup and one effect run back to back — and doing history
// work directly in each meant calling `history.back()` (ASYNCHRONOUS, it queues
// a traversal) and `history.pushState` (SYNCHRONOUS) in the same tick. The two
// race, the entry accounting comes out one short, and the next Back press finds
// nothing to spend and leaves the app. Reported exactly that way: Back inside
// Advanced Settings minimised VESTA, while Back inside Settings was correct.
//
// So nothing touches history inline. The stack is the truth, and a microtask
// afterwards makes the history depth match it. A swap is then free: one surface
// leaves and another arrives, the depth never changed, and no push or pop
// happens at all — which is both the fix and less work than before.

import { useEffect, useRef } from "react";

interface Entry {
  close: () => void;
}

const stack: Entry[] = [];
/** History entries WE added. Reconciled against `stack.length` — see syncHistory. */
let pushed = 0;
/** Programmatic traversals whose `popstate` must be ignored. */
let unwinding = 0;
let listening = false;
let queued = false;

/** Make the history depth match the stack. The ONE place history is written. */
function syncHistory(): void {
  queued = false;  // a later change re-arms both passes
  const want = stack.length;
  if (want > pushed) {
    // Same URL — this app is served under an add-on ingress path that must not
    // change, and there is no route here to reflect anyway. The entries exist
    // purely to give Back something to consume.
    for (let i = pushed; i < want; i++) history.pushState({ vkOverlay: true }, "");
    pushed = want;
  } else if (want < pushed) {
    const drop = pushed - want;
    pushed = want;
    unwinding += drop;
    history.go(-drop);
  }
}

/**
 * Coalesce to ONE reconciliation per commit — that is what makes a swap free.
 *
 * ⚠️ TWO passes, and the second is not belt-and-braces: a microtask runs before
 * React has flushed its passive effects, so a reconciliation scheduled from
 * inside a `popstate` handler can settle while the stack still holds the surface
 * that is closing and before the surface replacing it has mounted. The follow-up
 * task runs after that flush and reconciles what the stack ACTUALLY became.
 *
 * Found by measurement, not reasoning: a press was recorded perfectly in sync
 * and handled correctly, and the NEXT one produced no `popstate` at all — no
 * entry existed, because the one for the re-mounted surface had never been
 * pushed. Reconciling only once, early, is how that happens.
 *
 * Both passes are idempotent — each compares depth against the stack and does
 * nothing when they already agree — so the extra pass costs a comparison in the
 * common case and cannot double-push.
 */
function scheduleSync(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(syncHistory);
  setTimeout(syncHistory, 0);
}

/**
 * Dismiss the surface on top — THE definition of "what does a dismiss gesture
 * dismiss", for every gesture that means it.
 *
 * Back is one caller. Escape is the other: the two are the same request in two
 * vocabularies, and before this they each carried their own idea of the order
 * to unwind in — Escape branching inside a single listener, Back stacking. Two
 * expressions of one rule is one expression too many, and the one that drifts
 * is the one nobody is looking at. The stack knows what is on top; neither
 * caller needs to.
 *
 * @returns false when nothing is registered, so a caller can fall through.
 */
export function dismissTop(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

function ensureListening(): void {
  if (listening) return;
  window.addEventListener("popstate", onPopState);
  listening = true;
}

function onPopState(): void {
  if (unwinding > 0) { unwinding -= 1; return; }
  // The browser just spent one of ours, so the depth is already correct — the
  // close below shrinks the stack to match and the reconciler finds nothing to
  // do. That accounting is what the old `popped` flag was for.
  if (pushed > 0) pushed -= 1;
  const top = stack[stack.length - 1];
  // ── A PRESS WITH NOTHING TO DISMISS IS THE PLATFORM'S ──────────────────
  // Let it through, and do not try to stop it. On Android a Back press at the
  // villa CLOSES the app — the document is destroyed and the next launch pays a
  // full rebuild — and 2.330.0 through 2.339.0 tried four ways to prevent that
  // from in here: swallowing the press, re-arming the entry synchronously, and
  // keeping one and then two spare entries beneath the villa so the traversal
  // could never reach the root. All four failed identically in the field. The
  // press is not being decided by history depth, so no arrangement of entries
  // can change it, and every attempt cost a behaviour the app wanted.
  //
  // HOME is the gesture that puts the app away with the document intact
  // (`lifecycle visible`, hiddenMs 35194, websocket reconnecting, nothing
  // rebuilt). If this is revisited, the only untried avenue is the Navigation
  // API's `navigate` event — measure before shipping, not after.
  if (!top) return;
  top.close();
  // The close above changes the stack through React, which settles after this
  // handler returns — so ask for a reconciliation explicitly rather than relying
  // on the mutation to arrive in time to schedule its own.
  scheduleSync();
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
    ensureListening();
    const entry: Entry = { close: () => latest.current() };
    stack.push(entry);
    scheduleSync();
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      scheduleSync();
    };
  }, [active]);
}

