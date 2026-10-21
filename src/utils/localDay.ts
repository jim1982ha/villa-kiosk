// src/utils/localDay.ts
// The villa's calendar, in the browser's own timezone — where HA's recorder
// cuts its day and month statistics (wall-clock days, not UTC ones: a UTC
// midnight would file the last hours of "today" under "yesterday").
//
// ⚠️ ONE COPY. It was written four times (the Energy window, the Weather
// window twice, the energy adapter). PURE; tests/oracles run it.

// The fixed lengths, once (they were defined or written out at some fifteen sites). A DURATION, never a calendar
// step: a day's EDGES are localMidnight / addLocalDays below, as a summer-time day is 23 or 25 hours.
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Local midnight of the day `now` falls in, moved by `offsetDays`. */
export function localMidnight(now: number, offsetDays = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

/** The same clock time `days` calendar days later — a day is midnight to midnight, so "every 7 days" keeps 09:00
 *  across a summer-time change (owner, 2026-10-20), where 7 × 24 h landed on 08:00 or 10:00. */
export function addLocalDays(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Local midnight on the 1st of the month `now` falls in, moved by `offsetMonths`. */
export function localMonthStart(now: number, offsetMonths = 0): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1).getTime();
}
