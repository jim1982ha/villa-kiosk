// src/utils/dateText.ts
// How a moment is written on screen — the app's date/time display formats,
// defined once (2.496.263). Every day, moment and time of day is the agreement's
// fixed form (clockTime, docDate, momentText, and dayShort for an axis tick), as
// Telegram writes them; only a month's name (monthShort, monthYear) follows the
// reader's own locale.
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
/** Two digits, for the fixed forms. */
const two = (n: number) => String(n).padStart(2, "0");

/** ⚠️ ONE WAY TO WRITE A MOMENT, BOTH APPS (agent-contract.json `moment`; owner, 2026-10-29: alert #83 said "24/10/2026
 *  19:05" on Telegram and "2026-10-24 19:05" on the tablet; day first, everywhere). ⚠️ AND ONE WAY TO WRITE A DAY,
 *  EVERYWHERE A PERSON READS (owner, 2026-11-05: a task card's "Due 31 Jan 2020", a chart's "29 Oct" and "4 Nov, 09:00"
 *  beside Telegram's "04/11/2026 08:56"): the agreement's day (`date`), moment (`format`) and its time, on the villa's
 *  clock, the same on every screen whatever the reader's locale. The "d Mon", "d Mon yyyy" and "d Mon, hh:mm" forms
 *  (dayMonth, fullDate, dayTime, stampText) are gone with their locale. */
const MOMENT: { format: string; date: string } = AGENT_CONTRACT.moment;
/** The time part of the agreement's moment ("%H:%M"). */
const TIME_FORMAT = MOMENT.format.replace(MOMENT.date, "").trim();
/** The agreement's day without its year ("%d/%m"), its separator with it. */
const SHORT_DAY_FORMAT = MOMENT.date.replace(/(\W)?%Y(\W)?/, (_m, a?: string, b?: string) => (a && b ? a : ""));
const written = (format: string, t: string | number | Date): string => {
  const d = at(t);
  if (!valid(d)) return "";
  const w = wallClock(d);
  const part: Record<string, string> = { d: two(w.day), m: two(w.month), Y: String(w.year), H: two(w.hour), M: two(w.minute) };
  return format.replace(/%([dmYHM])/g, (_, c: string) => part[c]);
};

/** "14:05" — a time of day: the HUD's clock, a chart's axis, "closes at about 14:49" (the agreement's time). */
export function clockTime(t: string | number | Date): string {
  return written(TIME_FORMAT, t);
}

/** "03/10/2026" — a day: a due date, a chart's day, a "since" older than the villa keeps, a row of a saved document
 *  (the agreement's day form). ⚠️ A document is archived and read years later, possibly on another device: a row
 *  written in the generating phone's locale ("05 Sept 2026" / "Sep 5, 2026") changed shape with the browser, and one
 *  check comparing such a row died on the build server (2.496.424). */
export function docDate(t: string | number | Date): string {
  return written(MOMENT.date, t);
}

/** "03/10" — the day where the whole of it does not fit: a chart's axis tick only (three under a phone's chart, a
 *  slider beside it), its year in the tooltip above (fmtStepStamp). The agreement's day, its year left out. */
export function dayShort(t: string | number | Date): string {
  return written(SHORT_DAY_FORMAT, t);
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

/** "20/10/2026 02:00" — a moment, as the VESTA Agent's messages write it on Telegram (its timeutil.moment_label, the
 *  agreement's form): a card's steps, a ticket's history, a document's "Generated:", the Overview's "Next check", a
 *  chart's tooltip beyond today, an upload's or an Agent edit's time. */
export function momentText(t: string | number | Date = Date.now()): string {
  return written(MOMENT.format, t);
}
