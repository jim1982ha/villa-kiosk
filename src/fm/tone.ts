// src/fm/tone.ts
// HOW BAD A THING IS, as every tinted card of the Facility screens says it — a task's due state, a Recap check, the
// month's spending cap. One answer per state, one look per answer (`.tone-warn` / `.tone-danger`, 08-shared.css).
//
// ⚠️ FOUR VOCABULARIES, FOUR COPIES (architecture review "One answer per question" #3, 2026-10-19): the same tinted
// frame was written four times in 07-facility.css under `state-overdue`, `warn/fail`, `approaching/exceeded` — and a
// Recap check borrowed the Schedule's words for its colour (`warn` drawn as `state-due-soon`). Each screen now says
// which tone its state is, here, and the stylesheet draws a tone once.
//
// A due state's tone and a check state's tone live WITH their words (fmEngine.DUE_WORDS, readiness.CHECK_WORDS):
// one table per vocabulary, the word and the colour side by side, as STAGE_WORDS already had them. The cap's states
// have no word of their own (the Spend tab draws a bar and a note: fmEngine.capNotes), so their tone is here.

import type { SpendCapState } from "./fmEngine";

export type Tone = "ok" | "warn" | "danger";

/** Each state of a kind with no word table, as a tone. */
export const TONE_OF = {
  cap: { ok: "ok", approaching: "warn", exceeded: "danger" } satisfies Record<SpendCapState, Tone>,
} as const;

/** A tone's class on a card: none when all is well. */
export const toneClass = (t: Tone): string => (t === "ok" ? "" : `tone-${t}`);

/** A tone's class on a status pill (RecordCard `status.tone`, 07-facility.css .fm-badge): a pill is always filled, so
 *  its ok is drawn too (green, as a task's "ok" pill) — only a card's frame is left plain when all is well. */
export const pillClass = (t: Tone): string => `tone-${t}`;
