// src/utils/storeSave.ts
// What the add-on's answer to a store write MEANS, for both shared stores (the device setup, config/deviceConfig; the
// maintenance record, fm/fmApi), and the one line a screen says when a write did not land. Pure: an oracle hands it
// answers by value (tests/oracles/store_save.mjs).
//
// ⚠️ IT WAS WRITTEN TWICE (architecture review H, 2026-10-23). The Facility store read 400/403/413 as the add-on's NO
// (final: undone and said); the device-setup store read every one of them as a Wi-Fi blip. A refused device-setup
// change was then kept, marked unsaved and sent again on every refresh for good, and while it waited this tablet took
// no other tablet's change; nobody was told.

import type { StoreSaveResult } from "./keyedSync";

/** The answers that are the add-on saying NO, with its reason: final, never sent again. Not 401: an expired sign-in
 *  is re-established (auth/sessionLost) and the change is worth sending again after it. */
const REFUSED = new Set([400, 403, 413]);

/** The add-on's answer to a write, as a save result (keyedSync pushWithRebase reads it): 409 another write landed
 *  first; 400/403/413 refused; any other failure a transport one (kept here, sent again on the next refresh). A request
 *  that THREW is the caller's transport failure. */
export async function storeSaveResult(r: Pick<Response, "ok" | "status" | "json">): Promise<StoreSaveResult> {
  if (r.status === 409) return { ok: false, conflict: true };
  if (REFUSED.has(r.status)) {
    const e = (await r.json().catch(() => ({}))) as { error?: unknown };
    return { ok: false, conflict: false, refused: true, message: typeof e.error === "string" ? e.error : undefined };
  }
  if (!r.ok) return { ok: false, conflict: false };
  const d = (await r.json().catch(() => ({}))) as { rev?: unknown };
  return { ok: true, rev: typeof d.rev === "string" ? d.rev : "0" };
}

/** What a screen says when a push did not land, the same words for both stores: refused (undone), or kept only on
 *  this device (sent again on the next refresh). Null: nothing to say (saved, or nothing to send). */
export function saveProblemLine(outcome: { ok: true } | { ok: false; reason: string; message?: string }): string | null {
  if (outcome.ok) return null;
  if (outcome.reason === "refused") {
    const message = outcome.message;
    return message ? `The add-on refused this change: ${message}` : "The add-on refused this change, nothing was saved.";
  }
  if (outcome.reason === "transport" || outcome.reason === "conflict-retries-exhausted") return UNSAVED_LINE;
  return null;
}

export const UNSAVED_LINE = "Couldn't save to the add-on, the change is only on this device.";
