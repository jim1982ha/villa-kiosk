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
 * every form and every button that saves (2.496.252). ⚠️ APPLIED BY THE
 * STORE, NOT BY EACH SCREEN (architecture review, 2026-10-19): every mutator
 * of FmDataContext returns this (run), so no form can skip it — the 2.496.252
 * defect was one that did. This function is internal to the store; a screen
 * reads `done` and `note` off what its mutator returned.
 *
 *   result — the write's own result, for the one screen that says "Saved"
 *            only when saved (useMonthlyDocument).
 *   done   — the form may empty or the dialog close: the change is saved, or
 *            it is QUEUED on this device and will be sent on its own (offline).
 *   note   — what to tell the person, or null.
 *   queued — kept on this device, to be sent on its own (offline).
 *
 * ⚠️ OFFLINE IS DONE, NOT "TRY AGAIN". An offline write stays on this device
 * and the next refresh re-sends it (mutate, syncedDocument), so the old words —
 * "nothing was sent… try again" — were false, and obeying them filed a SECOND
 * copy: a guest pressing Send again reported the same fault twice. And three
 * forms (Faults, Spend, Today) plus the schedule editor emptied themselves
 * whatever happened, so a REFUSED save threw away what the facility manager
 * had typed. Refused is the only result that keeps the form.
 */
export interface FmSaveOutcome { result: FmWriteResult; done: boolean; note: string | null; queued: boolean }
export function fmSaveOutcome(r: FmWriteResult): FmSaveOutcome {
  if (r === "refused") return { result: r, done: false, note: "The add-on refused this, nothing was saved. What you typed is still here.", queued: false };
  if (r === "offline") return { result: r, done: true, note: "Saved on this device, it will be sent automatically when the add-on can be reached.", queued: true };
  return { result: r, done: true, note: null, queued: false };
}

/** What this device says when a fault it changed had just been changed on another device, and a field both changed kept
 *  the other device's value (fmApi foldOthers `changedOnBoth`). */
export const CHANGED_ON_ANOTHER_DEVICE = "This fault was just changed on another device.";

/** What this device says when a fault it changed had been removed on another device meanwhile: its step is not applied,
 *  and the fault stays removed (fmApi foldOthers `removedElsewhere`). */
export const REMOVED_ON_ANOTHER_DEVICE = "This fault was removed on another device, so this step was not saved.";

/**
 * The line a screen of the maintenance record shows INSTEAD of it while the record has not been read (FmDataContext
 * `ready`, `unreachable`): never an empty record shown as the villa's (architecture review H, 2026-10-23: unread on
 * opening, the Cockpit and every Facility tab showed no fault and said nothing). Null once read.
 */
export function fmRecordLine(s: { ready: boolean; unreachable: boolean }): string | null {
  if (s.ready) return null;
  return s.unreachable ? "Can't reach the add-on. Retrying." : "Loading the maintenance record…";
}
