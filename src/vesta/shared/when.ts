// src/vesta/shared/when.ts
//
// A stored stamp, shown in the reader's own clock.
//
// ⚠️ EIGHT COPIES, ONE FORMAT, FOUR ANSWERS TO FAILURE (2026-09-06). Every
// agent panel wrote its own: `new Date(iso)`, `Number.isNaN(d.getTime())`,
// `toLocaleString(undefined, { day, month, hour, minute })`. Four produced the
// IDENTICAL format and disagreed only about an unparseable stamp — `""` in two,
// the raw ISO in two, and `iso.replace("T", " ").slice(0, 16)` in a fifth.
// Nobody chose that; it is what happens when a rule is stated in comments.
//
// ⚠️ THE FAILURE POLICY IS AN ARGUMENT, NOT A DEFAULT, and that is the point of
// the module. A settled fact that will not parse is worth showing raw — a
// reader can act on `2026-08-27T09:23` even malformed. An optional stamp that
// will not parse is worth hiding, because "" reads as "not yet" and a broken
// string reads as a fault. Both are right; which one is a call site's decision,
// and it should be visible there rather than buried in a private helper.
//
// ⚠️ THE VILLA'S WALL CLOCK IS A DIFFERENT QUESTION AND IS NOT HERE.
// `ScheduleTab` formats a schedule hour with `timeZone: "UTC"` on purpose — a
// brief that goes at 08:00 goes at the villa's 08:00, not the reader's — and
// its own comment says so. Folding it in would make one function answer two
// questions, which is the defect this file is fixing.
//
// ⚠️ THE DEFECT THIS PAYS FOR: `RecentChecks` carries a nine-line note about a
// shipped bug — "one card, two clocks, eight hours apart" — caused by half a
// card being formatted and half not.

/** What to show when a stamp cannot be parsed. */
export type Unparseable = "blank" | "raw";

const fallback = (iso: string, policy: Unparseable) =>
  policy === "raw" ? iso : "";

const format = (iso: string, opts: Intl.DateTimeFormatOptions,
                policy: Unparseable): string => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? fallback(iso, policy)
    : at.toLocaleString(undefined, opts);
};

/** `2026-08-27T09:23:55Z` → `27 Aug, 17:23`, in the reader's own zone. */
export const whenShort = (iso: string, policy: Unparseable = "blank"): string =>
  format(iso, { day: "numeric", month: "short",
                hour: "2-digit", minute: "2-digit" }, policy);

/** As `whenShort`, plus the weekday — for a list a reader scans by day. */
export const whenLong = (iso: string, policy: Unparseable = "blank"): string =>
  format(iso, { weekday: "short", day: "numeric", month: "short",
                hour: "2-digit", minute: "2-digit" }, policy);

/** Just the clock, for a stamp whose date the surrounding text already gives. */
export const timeOnly = (iso: string, policy: Unparseable = "blank"): string =>
  format(iso, { hour: "2-digit", minute: "2-digit" }, policy);
