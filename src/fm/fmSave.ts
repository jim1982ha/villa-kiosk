// src/fm/fmSave.ts
// A Facility write's result, and what a screen does with it — pure, so
// tests/oracles/fm_write_outcome.mjs drives it by value.

/**
 * What happened to one Facility write — returned by EVERY mutator, so a screen
 * can say it (round 13, 2.496.184). They all returned nothing: a guest was
 * told "that's been reported" and the report dialogs said "Saved" whatever
 * the add-on did.
 *   saved     — on the add-on.
 *   refused   — the add-on said no (the reason is in saveError); undone here.
 *   offline   — could not reach it; kept on this device and re-sent on the
 *               next refresh.
 *   unchanged — nothing to send.
 */
export type FmWriteResult = "saved" | "refused" | "offline" | "unchanged";

/**
 * What a Facility screen does with a write's result — THE one decision, for
 * every form and every button that saves (2.496.252).
 *
 *   done  — the form may empty or the dialog close: the change is saved, or it
 *           is QUEUED on this device and will be sent on its own (offline).
 *   note  — what to tell the person, or null.
 *
 * ⚠️ OFFLINE IS DONE, NOT "TRY AGAIN". An offline write stays on this device
 * and the next refresh re-sends it (mutate, syncedDocument), so the old words —
 * "nothing was sent… try again" — were false, and obeying them filed a SECOND
 * copy: a guest pressing Send again reported the same fault twice. And three
 * forms (Faults, Spend, Today) plus the schedule editor emptied themselves
 * whatever happened, so a REFUSED save threw away what the facility manager
 * had typed. Refused is the only result that keeps the form.
 */
export function fmSaveOutcome(r: FmWriteResult): { done: boolean; note: string | null } {
  if (r === "refused") return { done: false, note: "The add-on refused this — nothing was saved. What you typed is still here." };
  if (r === "offline") return { done: true, note: "Saved on this device — it will be sent automatically when the add-on can be reached." };
  return { done: true, note: null };
}
