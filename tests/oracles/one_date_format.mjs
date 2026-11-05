// tests/oracles/one_date_format.mjs
// ⚠️ ONE DATE FORMAT WHEREVER A PERSON READS (owner, 2026-11-05): the VESTA Agent writes "04/11/2026" and
// "04/11/2026 08:56" (the agreement's `moment`), while the Kiosk still drew "Due 31 Jan 2020" on a task card, "29 Oct"
// under a week's chart and "4 Nov, 09:00" in its tooltip. Every day, moment and time the Kiosk draws is the agreement's
// (utils/dateText); an axis tick, where the whole day does not fit, its day without the year. Driven through the
// screens' own formatters, and the tree searched for a locale day form coming back.
import { register } from "node:module";
register("../consistency/alias-hook.mjs", import.meta.url);
import { ck, done, tsFiles } from "../consistency/check.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const T = await import("@/utils/dateText");
const C = await import("@/components/panels/chartUtils");
const { shortDate } = await import("@/fm/fmEngine");
const { lastReportNote } = await import("@/ha/historySource");
const { DAY_MS, HOUR_MS } = await import("@/utils/localDay");

const DAY = /^\d\d\/\d\d\/\d{4}$/, MOMENT = /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/, TICK = /^\d\d\/\d\d$/;
const t = Date.UTC(2026, 10, 4, 1, 0), old = Date.now() - 3 * DAY_MS;
ck("a due date, a document's day: the app's day (\"Due 31 Jan 2020\" no more)", DAY.test(shortDate(t)) && shortDate(t) === T.docDate(t), shortDate(t));
ck("  ...a chart's day and week in its tooltip: the app's day", DAY.test(C.fmtStepStamp(t, DAY_MS, 720))
   && /^\d\d\/\d\d\/\d{4} – \d\d\/\d\d\/\d{4}$/.test(C.fmtStepStamp(t, 7 * DAY_MS, 8760)), [C.fmtStepStamp(t, DAY_MS, 720), C.fmtStepStamp(t, 7 * DAY_MS, 8760)]);
ck("  ...a chart's moment beyond today: the app's moment (\"4 Nov, 09:00\" no more)", MOMENT.test(C.fmtChartStamp(old, 168)) && C.fmtChartStamp(old, 168) === T.momentText(old), C.fmtChartStamp(old, 168));
ck("  ...an axis tick beyond two days: the app's day without its year, the same at every range", [168, 720, 8760].every((span) => TICK.test(C.fmtChartTick(t, span)))
   && T.docDate(t).startsWith(C.fmtChartTick(t, 168)), [168, 720, 8760].map((span) => C.fmtChartTick(t, span)));
ck("  ...a time of day: the agreement's (\"08:56\", never \"08:56 am\")", /^\d\d:\d\d$/.test(T.clockTime(t)) && T.momentText(t).endsWith(T.clockTime(t)), T.clockTime(t));
ck("  ...what is no longer kept, a moved window's last report: the app's moment",
   MOMENT.test(C.fmtOutage({ from: 0, to: t, notKept: true }, t + HOUR_MS).split(" · before ")[1]) && MOMENT.test(lastReportNote(t).replace("Last report ", "")),
   [C.fmtOutage({ from: 0, to: t, notKept: true }, t + HOUR_MS), lastReportNote(t)]);

// the set, from the tree: a locale form that names a day (day: in its options) is a second date format
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const locale = tsFiles(SRC).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/toLocale(?:Date)?String\([^)]*\{[^}]*\bday:[^}]*\}/g)]
  .map((m) => `${f.slice(SRC.length)}: ${m[0]}`));
// ⚠️ NO EXCEPTION (architecture review 28): "Wed 4", the Energy window's week and month bars, was let through as a
// weekday; it named a day of the month, a month of them no month. A weekday ALONE ("Wed") names no day: not matched.
ck("no locale day form left anywhere in the app", locale.length === 0, locale);
const T2 = Object.keys(T).sort().join();
ck("  ...dateText offers the agreement's forms and the months' names, nothing else",
   T2 === "clockTime,dayShort,docDate,momentText,monthShort,monthYear", T2);

done("✅ one date format wherever a person reads");
