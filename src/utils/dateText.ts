// src/utils/dateText.ts
// How a moment is written on screen — the app's date/time display formats,
// defined once (2.496.263). Each fixes its FIELDS (so a shape is stable) and
// leaves the ordering and spelling to the reader's own locale (`[]`), the rule
// fmEngine.shortDate set for the report.
//
// ⚠️ "3 Oct, 14:05" WAS WRITTEN OUT THREE TIMES (the Agent's activity, the
// history title, …) and a bare toLocaleString() gave a fourth look — seconds
// and all — wherever a "last changed" moment was shown.
//
// Not here, on purpose: fmEngine.localStamp ("2026-10-03 14:05"), a SORTABLE
// stamp for the report's tables, and the energy charts' weekday buckets,
// which name a day of the week rather than a moment.

const at = (t: string | number | Date): Date => (t instanceof Date ? t : new Date(t));
const valid = (d: Date) => !Number.isNaN(d.getTime());

/** "14:05" — a time today, a chart's axis. */
export function clockTime(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

/** "3 Oct" — a day, no year (a chart's axis beyond two days). */
export function dayMonth(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleDateString([], { day: "numeric", month: "short" }) : "";
}

/** "3 Oct, 14:05" — a recent moment (the Agent's activity, a history window's end). */
export function dayTime(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

/** "03 Oct 2026" — a date on its own (a due date, a report row). */
export function fullDate(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "";
}

/** "October 2026" — the month a report covers, spelled for a heading. */
export function monthYear(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleDateString([], { month: "long", year: "numeric" }) : "";
}

/** "3 Oct 2026, 14:05" — when something was changed or taken, which may be
 *  long ago (an upload, an Agent edit, a snapshot): the year, never seconds. */
export function stampText(t: string | number | Date): string {
  const d = at(t);
  return valid(d)
    ? d.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
}
