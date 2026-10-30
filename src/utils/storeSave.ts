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

/** The add-on's own reason for refusing a request: the `error` of its NO (REFUSED: supervisor-proxy.py _forbidden and
 *  every refusal), undefined when it gave none or the answer is no refusal (a 401 is a sign-in to renew, a 5xx a
 *  failure). ⚠️ ONE READER (architecture review round 8, 2026-10-30): a refused photo
 *  said "Only the owner or facility manager can add photos.", a reason guessed from the status and copied from a rule
 *  the add-on no longer had (guests may add photos), while the add-on's answer said the real one. */
export async function refusalOf(r: Pick<Response, "status" | "json">): Promise<string | undefined> {
  if (!REFUSED.has(r.status)) return undefined;
  const e = (await r.json().catch(() => ({}))) as { error?: unknown } | null;
  return typeof e?.error === "string" && e.error.trim() ? e.error.trim() : undefined;
}

/** The add-on's answer to a write, as a save result (keyedSync pushWithRebase reads it): 409 another write landed
 *  first; 400/403/413 refused; any other failure a transport one (kept here, sent again on the next refresh). A request
 *  that THREW is the caller's transport failure. */
export async function storeSaveResult(r: Pick<Response, "ok" | "status" | "json">): Promise<StoreSaveResult> {
  if (r.status === 409) return { ok: false, conflict: true };
  if (REFUSED.has(r.status)) return { ok: false, conflict: false, refused: true, message: await refusalOf(r) };
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

/** What a screen says when a write that cannot be sent again (a delete under its single-use superadmin code) did not
 *  land and was taken back: its true cause, never "refused" (architecture review O, 2026-10-27: a Wi-Fi drop said "The
 *  delete was refused by the add-on"). `what`: the action, as done ("deleted"). Null: it landed, or nothing was sent. */
export function notDoneLine(outcome: { ok: true } | { ok: false; reason: string; message?: string }, what: string): string | null {
  if (outcome.ok) return null;
  if (outcome.reason === "refused") return saveProblemLine(outcome);
  if (outcome.reason === "transport") return `Not ${what}: the add-on could not be reached, nothing was changed. Try again.`;
  if (outcome.reason === "conflict-retries-exhausted") {
    return `Not ${what}: another tablet was saving at the same moment, nothing was changed. Try again.`;
  }
  return null;
}
