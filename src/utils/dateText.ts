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
/** Two digits, for the fixed forms (docDate, momentText). */
const two = (n: number) => String(n).padStart(2, "0");

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

/** "Oct 2026" — a month as one value of a chart (a year drawn a month a bar). */
export function monthShort(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleDateString([], { month: "short", year: "numeric" }) : "";
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

/** "2026-10-03" — a date inside a SAVED DOCUMENT (a recap's or statement's row, a snapshot): the reader's local day,
 *  in the one fixed form the documents' "Generated:" stamp already uses (fmEngine.localStamp), whatever the phone's
 *  language. ⚠️ A document is archived and read years later, possibly on another device: a row written in the
 *  generating phone's locale ("05 Sept 2026" / "Sep 5, 2026") changed shape with the browser, and one check comparing
 *  such a row died on the build server (2.496.424). Screens keep the reader's locale (fullDate). */
export function docDate(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` : "";
}

/** "20/10/2026 02:00" — a moment as the VESTA Agent's messages write it on Telegram (its timeutil.moment_label): day,
 *  month, year, then the time, the same on every screen whatever the reader's locale (owner, 2026-10-19: the Overview's
 *  "Next check" tooltip, "20/10/2026 02:00"). */
export function momentText(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}` : "";
}
