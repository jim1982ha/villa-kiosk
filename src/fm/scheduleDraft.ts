// src/fm/scheduleDraft.ts
// The maintenance-task form, as values: what was typed, whether it can be
// saved, and the exact write it becomes. Pure — tests/oracles/schedule_draft.mjs.
//
// ⚠️ THREE DEFECTS LIVED IN THE COMPONENT (2.496.259), where no test reached:
//   * EDITING A PAUSED TASK RESUMED IT. The save sent `enabled: true` for an
//     edit as well as a new task, and updateSchedule merges the patch — so
//     fixing a typo in a paused task's title silently switched it back on.
//     A new task starts enabled; an edit never touches `enabled` (Pause and
//     Resume do).
//   * "1.5" WAS SAVED AS 15. The interval was read by deleting every
//     non-digit, so the dot vanished.
//   * ANYTHING NOT A NUMBER WAS SAVED AS "EVERY DAY". `Number("") || 0` then
//     `Math.max(1, …)` turned an empty or mistyped field into 1, and the Add
//     button stayed enabled.

import type { FmSchedule } from "./fmTypes";

export interface ScheduleDraft {
  title: string;
  clause: string;
  /** As typed — a number of days. */
  everyDays: string;
  room: string;
}

export const EMPTY_SCHEDULE_DRAFT: ScheduleDraft = { title: "", clause: "", everyDays: "90", room: "" };

export function scheduleToDraft(s: FmSchedule): ScheduleDraft {
  return { title: s.title, clause: s.clause ?? "", everyDays: String(s.everyDays), room: s.room ?? "" };
}

/** How the obligation is usually WRITTEN, mapped to days. Anything that isn't a
 *  whole number of days rounds DOWN (twice a week -> 3, not 4) so a genuinely
 *  late task can never read as compliant. */
export const SCHEDULE_PRESETS: { label: string; days: number }[] = [
  { label: "Twice a week", days: 3 },
  { label: "Weekly", days: 7 },
  { label: "Twice a month", days: 15 },
  { label: "Monthly", days: 30 },
  { label: "Every 3 months", days: 90 },
  { label: "Every 6 months", days: 180 },
  { label: "Every 12 months", days: 365 },
];

/** A task's interval as a person reads it: the words it was picked with ("Monthly"), else its days ("Every 10 days").
 *  ⚠️ ONE SET OF WORDS (UI scan, 2026-11-10): the form's chip said "Monthly", the task's card and the monthly document
 *  "every 30 days". */
export function everyWords(days: number): string {
  return SCHEDULE_PRESETS.find((p) => p.days === days)?.label ?? (days === 1 ? "Every day" : `Every ${days} days`);
}

/** The interval in whole days, or null when what was typed is not one. */
export function draftDays(everyDays: string): number | null {
  const t = everyDays.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 3650 ? n : null;
}

type Fields = Pick<FmSchedule, "title" | "clause" | "everyDays" | "room">;

type ScheduleWrite =
  | { ok: true; kind: "add"; fields: Fields & { enabled: true } }
  | { ok: true; kind: "edit"; id: string; patch: Fields }
  | { ok: false; problem: string };

/** What saving the form sends: a new task (enabled), or an edit's patch —
 *  which never carries `enabled`, so a paused task stays paused. */
export function scheduleWrite(draft: ScheduleDraft, editingId: string | null): ScheduleWrite {
  const title = draft.title.trim();
  if (!title) return { ok: false, problem: "Name the task." };
  const everyDays = draftDays(draft.everyDays);
  if (everyDays === null) return { ok: false, problem: "Enter the interval as a whole number of days (1 to 3650)." };
  const fields: Fields = { title, clause: draft.clause.trim() || undefined, everyDays, room: draft.room || undefined };
  return editingId ? { ok: true, kind: "edit", id: editingId, patch: fields } : { ok: true, kind: "add", fields: { ...fields, enabled: true } };
}
