// src/utils/villaClock.ts
// THE villa's time zone: the one every time and date the Kiosk shows is written in, and every day, week and month is
// cut in, whatever clock the phone or tablet reading it runs on.
//
// ⚠️ THE DEVICE'S ZONE (owner, 2026-10-28: "cards match Telegram wherever the phone is"): every time was written in the
// browser's own zone, so a phone abroad read a nightly check at "21:00" that Telegram, in the villa's zone, called
// "02:00", and its "today" began at its own midnight. The zone is the villa system's own setting (its configuration's
// time_zone, read live from the connection: entityStore sets it here when it arrives); until then, the device's zone.
//
// Pure, no Temporal (iPhone Safari): Intl's `timeZone` option, supported everywhere the app runs.
// Tests: tests/oracles/villa_time_zone.mjs.

let zone: string | undefined;
let parts: Intl.DateTimeFormat | null = null;

/** Set the villa's zone from its configuration; a value Intl does not know leaves the zone as it was. */
export function setVillaTimeZone(tz: unknown): void {
  if (typeof tz !== "string" || !tz.trim() || tz === zone) return;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
  } catch {
    return;
  }
  zone = tz;
  parts = null;
}

/** The villa's zone, or undefined while its configuration is not known (the device's zone then). */
export function villaTimeZone(): string | undefined {
  return zone;
}

/** `opts` for a toLocale…String call, in the villa's zone. */
export function inVillaZone<T extends Intl.DateTimeFormatOptions>(opts: T): T {
  return zone ? { ...opts, timeZone: zone } : opts;
}

/** A moment's wall clock at the villa: month 1 to 12, weekday 0 (Sunday) to 6. */
export interface WallClock {
  year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** What the villa's clock and calendar read at `t`. */
export function wallClock(t: number | Date): WallClock {
  const d = t instanceof Date ? t : new Date(t);
  if (!zone) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(),
      minute: d.getMinutes(), second: d.getSeconds(), weekday: d.getDay() };
  }
  parts ??= new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, weekday: "short", year: "numeric",
    month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const p: Record<string, string> = {};
  for (const x of parts.formatToParts(d)) p[x.type] = x.value;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day),
    // an older engine writes midnight "24" under hour12: false
    hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second), weekday: WEEKDAYS.indexOf(p.weekday) };
}

/** The moment the villa's clock reads this date and time; a month or day past its end rolls over (day 0 is the last
 *  of the month before), as Date's own constructor does. */
export function villaTime(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  if (!zone) return new Date(year, month - 1, day, hour, minute, second).getTime();
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // the zone's offset at a moment: its wall clock read as if it were UTC, less the moment
  const offset = (t: number) => {
    const w = wallClock(t);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(t / 1000) * 1000;
  };
  const first = asUtc - offset(asUtc);
  const again = asUtc - offset(first);          // across a summer-time change the offset differs: once more
  return again;
}
