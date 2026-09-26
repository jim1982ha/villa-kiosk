// src/utils/localDay.ts
// The villa's calendar, in the browser's own timezone — where HA's recorder
// cuts its day and month statistics (wall-clock days, not UTC ones: a UTC
// midnight would file the last hours of "today" under "yesterday").
//
// ⚠️ ONE COPY. It was written four times (the Energy window, the Weather
// window twice, the energy adapter). PURE; tests/oracles run it.

/** Local midnight of the day `now` falls in, moved by `offsetDays`. */
export function localMidnight(now: number, offsetDays = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

/** Local midnight on the 1st of the month `now` falls in, moved by `offsetMonths`. */
export function localMonthStart(now: number, offsetMonths = 0): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1).getTime();
}
