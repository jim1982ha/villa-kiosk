// src/utils/reopen.ts
// THE ONE WAY VESTA UI OPENS ITSELF AGAIN: the view switch, the update notice, the 04:00 reopen, the error screen,
// "Try once more" and a scene found dead all ask here, for their own reason, and it decides when and how.
//
// ⚠️ SIX PLACES, EACH WITH ITS OWN IDEA OF "SAFE" (architecture review, 2026-11-25): the view switch alone took three
// fixes found by the owner one at a time (an address asking `?view=3d` set the old view back, a replace to the same
// address with a `#` opened nothing, closing Settings stepped history back and cancelled the reload), and only the
// 04:00 reopen waited for work the add-on has not got. Every reopen now:
//   1. waits until no window is open and history is back at the villa (useBackToClose whenAllClosed): a reload asked
//      as a window closes is cancelled by the close's own step back;
//   2. waits while a store holds work the add-on has not got (syncedDocument unsentWorkHeld), asking again every
//      UNSENT_RETRY_MS: a fault reported offline lived in the page alone;
//   3. opens the address without its `?view=` (this opening already kept that choice: deviceVerdict), and reloads the
//      same address rather than replacing it;
//   4. happens once per page: a second ask while one waits is the same reopen.
// The browser is passed in (ReopenPorts), so tests/oracles/reopen.mjs decides each case by value.

import { overlayOpen, whenAllClosed } from "@/hooks/useBackToClose";
import { unsentWorkHeld } from "./syncedDocument";

/** How often a reopen held by unsent work asks again. */
export const UNSENT_RETRY_MS = 5_000;

/** What a reopen needs from the browser and the page. */
export interface ReopenPorts {
  whenAllClosed(fn: () => void): void;
  unsentWorkHeld(): boolean;
  href(): string;
  reload(): void;
  replace(url: string): void;
  later(fn: () => void, ms: number): void;
}

/** `href` without the `?view=` that asks for a view (deviceVerdict.judgeDevice keeps the one it asks for, on every
 *  opening, so an address carrying it would set that view back after every switch). */
export function withoutViewAsked(href: string): string {
  const u = new URL(href);
  u.searchParams.delete("view");
  return u.toString();
}

export function createReopen(ports: ReopenPorts): () => void {
  let asked = false;
  const open = () => {
    if (ports.unsentWorkHeld()) { ports.later(() => ports.whenAllClosed(open), UNSENT_RETRY_MS); return; }
    const href = ports.href();
    const next = withoutViewAsked(href);
    if (next === href) ports.reload();
    else ports.replace(next);
  };
  return () => {
    if (asked) return;
    asked = true;
    ports.whenAllClosed(open);
  };
}

/** Open VESTA UI again, when it is safe (see the top of this file). */
export const reopen = createReopen({
  whenAllClosed,
  unsentWorkHeld,
  href: () => location.href,
  reload: () => location.reload(),
  replace: (url) => location.replace(url),
  later: (fn, ms) => { setTimeout(fn, ms); },
});

/** Would a reopen happen at once: no window open, no unsent work. What the 04:00 reopen waits for, minute by minute,
 *  so it never waits holding the page. */
export const canReopenNow = (): boolean => !overlayOpen() && !unsentWorkHeld();
