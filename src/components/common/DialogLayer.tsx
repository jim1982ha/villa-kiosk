// src/components/common/DialogLayer.tsx
// Every dialog's backdrop (`.modal-backdrop`), drawn at the top of the app —
// never inside the screen that opened it.
//
// ⚠️ A DIALOG INSIDE A CARD MOVED WITH THE CARD (owner, 2026-10-21: "Open
// Ticket … i can't click anywhere and the UI is very buggy"). The Cockpit's
// "Open a ticket" was drawn inside the fault's card, which sits in the
// Cockpit's scrolling body. A press anywhere in the dialog was also a press
// on that card (`.fm-openable:active` nudges it 1 px with a transform), and a
// transformed box becomes the containing block of the absolutely placed
// backdrop: on every touch the whole dialog jumped into the card's box and
// back, under the finger. The scrolling body around it is a second trap of
// the same kind on iPad Safari. A dialog is a layer of the APP, so every one
// is drawn here, in the app's shell (`.app-root`, the box sized to the real
// screen — see 01-base.css), whoever opens it.
//
// Nothing else changes: React still sees the dialog where it was written
// (its clicks reach the same handlers), the Back/Escape stack is
// useModalA11y's, and a dialog opened later is appended later, so it stands
// over the one that opened it.
//
// ⚠️ EXCEPT IN FULL SCREEN, where only the full-screen box is drawn: a camera
// in full screen asking "Sound the siren?" into the shell would ask where
// nobody can see it, and wait. Then the dialog goes into that box.

import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { createPortal } from "react-dom";

/** The box every backdrop fills: the app's shell (App.tsx), not the page —
 *  on iOS the page's own height can be stale, the shell's is corrected. */
const HOST = ".app-root";

function host(): Element | null {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement ?? document.querySelector(HOST);
}

export default function DialogLayer({ className, onClick, style, children }: {
  className: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const backdrop = <div className={className} onClick={onClick} style={style}>{children}</div>;
  const into = host();
  return into ? createPortal(backdrop, into) : backdrop;
}
