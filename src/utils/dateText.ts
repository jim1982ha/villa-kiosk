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
// Not here, on purpose: the energy charts' weekday buckets, which name a day
// of the week rather than a moment.
//
// ⚠️ IN THE VILLA'S TIME ZONE (owner, 2026-10-28): every form here is written on the villa's clock (utils/villaClock),
// never the reading device's, so a card says the time Telegram says wherever the phone is.

import AGENT_CONTRACT from "../../rootfs/usr/share/vesta/agent-contract.json" with { type: "json" };
import { inVillaZone, wallClock } from "./villaClock";

const at = (t: string | number | Date): Date => (t instanceof Date ? t : new Date(t));
const valid = (d: Date) => !Number.isNaN(d.getTime());
/** Two digits, for the fixed forms (docDate, momentText). */
const two = (n: number) => String(n).padStart(2, "0");

/** "14:05" — a time today, a chart's axis. */
export function clockTime(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleTimeString([], inVillaZone({ hour: "2-digit", minute: "2-digit" })) : "";
}

/** "3 Oct" — a day, no year (a chart's axis beyond two days). */
export function dayMonth(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleDateString([], inVillaZone({ day: "numeric", month: "short" })) : "";
}

/** "3 Oct, 14:05" — a recent moment (the Agent's activity, a history window's end). */
export function dayTime(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleString([], inVillaZone({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) : "";
}

/** "03 Oct 2026" — a date on its own (a due date, a report row). */
export function fullDate(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleDateString([], inVillaZone({ day: "2-digit", month: "short", year: "numeric" })) : "";
}

/** "Oct 2026" — a month as one value of a chart (a year drawn a month a bar). */
export function monthShort(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleDateString([], inVillaZone({ month: "short", year: "numeric" })) : "";
}

/** "October 2026" — the month a report covers, spelled for a heading. */
export function monthYear(t: string | number | Date): string {
  const d = at(t);
  return valid(d) ? d.toLocaleDateString([], inVillaZone({ month: "long", year: "numeric" })) : "";
}

/** "3 Oct 2026, 14:05" — when something was changed or taken, which may be
 *  long ago (an upload, an Agent edit, a snapshot): the year, never seconds. */
export function stampText(t: string | number | Date): string {
  const d = at(t);
  return valid(d)
    ? d.toLocaleString([], inVillaZone({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }))
    : "";
}

/** ⚠️ ONE WAY TO WRITE A MOMENT, BOTH APPS (agent-contract.json `moment`; owner, 2026-10-29: alert #83 said "24/10/2026
 *  19:05" on Telegram and "2026-10-24 19:05" on the tablet; day first, everywhere). On the villa's clock, the same on
 *  every screen whatever the reader's locale. */
const MOMENT: { format: string; date: string } = AGENT_CONTRACT.moment;
const written = (format: string, t: string | number | Date): string => {
  const d = at(t);
  if (!valid(d)) return "";
  const w = wallClock(d);
  const part: Record<string, string> = { d: two(w.day), m: two(w.month), Y: String(w.year), H: two(w.hour), M: two(w.minute) };
  return format.replace(/%([dmYHM])/g, (_, c: string) => part[c]);
};

/** "03/10/2026" — a day inside a SAVED DOCUMENT (a recap's or statement's row, a snapshot): the agreement's day form.
 *  ⚠️ A document is archived and read years later, possibly on another device: a row written in the generating
 *  phone's locale ("05 Sept 2026" / "Sep 5, 2026") changed shape with the browser, and one check comparing such a row
 *  died on the build server (2.496.424). Screens keep the reader's locale (fullDate). */
export function docDate(t: string | number | Date): string {
  return written(MOMENT.date, t);
}

/** "20/10/2026 02:00" — a moment as the VESTA Agent's messages write it on Telegram (its timeutil.moment_label, the
 *  agreement's form): a card's steps, a ticket's history, a document's "Generated:", the Overview's "Next check". */
export function momentText(t: string | number | Date = Date.now()): string {
  return written(MOMENT.format, t);
}
